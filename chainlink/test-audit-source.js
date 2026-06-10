#!/usr/bin/env node
/**
 * test-audit-source.js
 *
 * Local simulation of the Chainlink Functions DON environment for audit-source.js.
 * Validates that:
 *   1. The output is exactly 160 bytes (5 × 32-byte ABI words).
 *   2. Word 0 = finalScore, clamped to [0,100].
 *   3. Words 1-3 = reliability/quality/marketFit, each clamped to [0,100].
 *   4. Word 4 = non-zero SHA-256 content hash.
 *   5. finalScore ≈ 40%×R + 30%×Q + 30%×M (within ±2 rounding).
 *
 * Run: node chainlink/test-audit-source.js
 *
 * The script mocks the Chainlink DON globals (`args`, `secrets`, `Functions`)
 * and intercepts `return result` by wrapping the source in an async function.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ── Colour helpers ────────────────────────────────────────────────────────────
const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(GREEN(`  ✓ ${msg}`)); passed++; }
  else       { console.log(RED(`  ✗ ${msg}`));  failed++;  }
}

// ── Mock Chainlink DON globals ────────────────────────────────────────────────
const mockArgs = ["42", "0xdeadbeefdeadbeef", "https://example.com/project"];
const mockSecrets = {
  ZG_API_KEY:  process.env.ZG_API_KEY  || "",
  ZG_BASE_URL: process.env.ZG_BASE_URL || "",
};

// Mock Functions.makeHttpRequest using Node built-in http/https
function makeHttpRequest({ url, method, headers, data, timeout }) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ data: JSON.parse(raw), error: false });
        } catch (e) {
          resolve({ error: true, message: "JSON parse failed: " + raw.slice(0, 100) });
        }
      });
    });
    req.on("error", (e) => resolve({ error: true, message: e.message }));
    req.setTimeout(timeout || 9000, () => {
      req.destroy();
      resolve({ error: true, message: "Request timed out" });
    });
    req.write(body);
    req.end();
  });
}

// Mock crypto.subtle.digest using Node crypto
const nodeCrypto = require("crypto");
const cryptoMock = {
  subtle: {
    digest: async (_algo, data) => {
      const hash = nodeCrypto.createHash("sha256").update(data).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    }
  }
};

// ── Load and wrap audit-source.js ────────────────────────────────────────────
const sourcePath = path.join(__dirname, "audit-source.js");
const rawSource  = fs.readFileSync(sourcePath, "utf8");

// The DON wraps the source in an async function. We do the same,
// replacing bare `return result` with a captured return.
const wrappedSource = `
(async function() {
  const args    = __args;
  const secrets = __secrets;
  const Functions = __Functions;
  const crypto    = __crypto;
  ${rawSource}
})()
`;

// ── Run the simulation ────────────────────────────────────────────────────────
async function run() {
  console.log(BOLD("\n═══ audit-source.js Local Simulation ═══\n"));
  console.log(`Source: ${sourcePath}`);
  console.log(`Args:   ${JSON.stringify(mockArgs)}`);
  console.log(`API key present: ${mockSecrets.ZG_API_KEY ? "yes" : "no (using default)"}\n`);

  // Evaluate the source in a context with DON globals injected.
  // IMPORTANT: "return \n(async...)" triggers ASI → use .trim() to avoid it.
  let result;
  try {
    const fn = new Function(
      "__args", "__secrets", "__Functions", "__crypto",
      "return (" + wrappedSource.trim() + ")"
    );
    result = await fn(mockArgs, mockSecrets, { makeHttpRequest }, cryptoMock);
  } catch (e) {
    console.log(RED(`\nFATAL: Source threw an error: ${e.message}`));
    console.error(e);
    process.exit(1);
  }

  // ── Format checks ─────────────────────────────────────────────────────────
  console.log(BOLD("1. Response format:"));
  assert(result instanceof Uint8Array, "result is Uint8Array");
  assert(result.length === 160, `result is exactly 160 bytes (got ${result.length})`);

  // Decode words
  function readWord(buf, offset) {
    let n = 0n;
    for (let i = 0; i < 32; i++) n = (n << 8n) | BigInt(buf[offset + i]);
    return Number(n);
  }

  const finalScore  = readWord(result, 0);
  const reliability = readWord(result, 32);
  const quality     = readWord(result, 64);
  const marketFit   = readWord(result, 96);
  const hashHex = Array.from(result.slice(128, 160))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  console.log(`\n  Decoded values:`);
  console.log(`    finalScore  = ${finalScore}`);
  console.log(`    reliability = ${reliability}`);
  console.log(`    quality     = ${quality}`);
  console.log(`    marketFit   = ${marketFit}`);
  console.log(`    contentHash = 0x${hashHex.slice(0, 8)}...${hashHex.slice(-8)}`);

  console.log(BOLD("\n2. Value range checks:"));
  assert(finalScore  >= 0 && finalScore  <= 100, `finalScore in [0,100]: ${finalScore}`);
  assert(reliability >= 0 && reliability <= 100, `reliability in [0,100]: ${reliability}`);
  assert(quality     >= 0 && quality     <= 100, `quality in [0,100]: ${quality}`);
  assert(marketFit   >= 0 && marketFit   <= 100, `marketFit in [0,100]: ${marketFit}`);
  assert(hashHex !== "0".repeat(64), "contentHash is non-zero");

  console.log(BOLD("\n3. Weighted score formula (40%×R + 30%×Q + 30%×M):"));
  const expected = Math.min(100, Math.round(
    (reliability * 4000 + quality * 3000 + marketFit * 3000) / 10000
  ));
  assert(Math.abs(finalScore - expected) <= 2,
    `finalScore (${finalScore}) ≈ computed (${expected}) within ±2`);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(BOLD("\n════════════════════════════════════════"));
  if (failed === 0) {
    console.log(GREEN(`✅  All ${passed} checks passed!`));
  } else {
    console.log(RED(`❌  ${failed} of ${passed + failed} checks failed.`));
    process.exit(1);
  }
}

run().catch((e) => { console.error(RED("Unhandled error:"), e); process.exit(1); });
