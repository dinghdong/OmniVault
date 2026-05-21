// ─────────────────────────────────────────────────────────────────────────────
// OmniVault — Chainlink Functions AI Audit Source (single-call)
// Runs inside the Chainlink DON (Decentralized Oracle Network).
//
// args:    [0] projectId (string), [1] sourceCodeHash (hex string), [2] bizApi (string)
// secrets: ZG_API_KEY, ZG_BASE_URL
//
// Returns: score(32) + contentHash(32) + summaryJSON(≤192 bytes UTF-8)
// ─────────────────────────────────────────────────────────────────────────────

const projectId      = args[0];
const sourceCodeHash = args[1];
const bizApi         = args[2];

const BASE   = secrets.ZG_BASE_URL || "https://router-api-testnet.integratenetwork.work/v1";
const APIKEY = secrets.ZG_API_KEY  || "sk-6d323fcd-2083-4a00-850d-1b8d1273d45b";
const MODEL  = "qwen/qwen-2.5-7b-instruct";

// ── Single comprehensive audit call ──────────────────────────────────────────
const res = await Functions.makeHttpRequest({
  url: `${BASE}/chat/completions`,
  method: "POST",
  headers: {
    "Authorization": `Bearer ${APIKEY}`,
    "Content-Type": "application/json",
  },
  data: {
    model: MODEL,
    messages: [{
      role: "user",
      content: `You are an AI investment committee for a decentralized VC fund auditing a Web3 project.

Project commit hash: ${sourceCodeHash}
Project info: ${bizApi || "No additional info provided."}

Perform a 3-dimension audit and respond ONLY with valid JSON (no markdown, no explanation):
{
  "securityScore": <0-100, smart contract security>,
  "securityFindings": ["<finding1>", "<finding2>"],
  "riskScore": <0-100, DeFi/market/regulatory risk>,
  "riskFactors": ["<risk1>", "<risk2>"],
  "finalScore": <0-100, weighted average>,
  "recommendation": "<APPROVE or REJECT>",
  "rationale": "<one concise sentence explaining the decision>"
}

Threshold for APPROVE: finalScore >= 60.`,
    }],
    max_tokens: 500,
  },
  timeout: 9000,
});

if (res.error) throw new Error(`0G Compute error: ${res.message || res.code}`);

const raw = res.data.choices[0].message.content.trim();

// ── Parse response ────────────────────────────────────────────────────────────
function safeNum(obj, key, fb) {
  const v = obj[key];
  return typeof v === "number" ? Math.min(100, Math.max(0, Math.round(v))) : fb;
}
function safeStr(obj, key, fb) {
  return typeof obj[key] === "string" ? obj[key] : fb;
}
function safeArr(obj, key) {
  return Array.isArray(obj[key]) ? obj[key].slice(0, 2) : [];
}

let parsed = {};
try {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  parsed = JSON.parse(cleaned);
} catch (_) {}

const s1          = safeNum(parsed, "securityScore", 50);
const s2          = safeNum(parsed, "riskScore",     50);
const s3          = safeNum(parsed, "finalScore",    Math.round((s1 + s2) / 2));
const finalScore  = Math.round((s1 + s2 + s3) / 3);
const rec         = safeStr(parsed, "recommendation", "UNKNOWN");
const rationale   = safeStr(parsed, "rationale", "").slice(0, 100);
const findings    = safeArr(parsed, "securityFindings").map(f => String(f).slice(0, 55));
const risks       = safeArr(parsed, "riskFactors").map(r => String(r).slice(0, 55));

// ── Content hash: SHA-256 of full audit output ────────────────────────────────
const auditLog = JSON.stringify({ projectId, sourceCodeHash, model: MODEL, raw, scores: { s1, s2, s3, finalScore } });
const hashBuf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auditLog));
const hashHex  = Array.from(new Uint8Array(hashBuf))
  .map(b => b.toString(16).padStart(2, "0")).join("");

// ── Compact summary for on-chain display (≤192 bytes) ────────────────────────
const summary = JSON.stringify({
  s: [s1, s2, s3, finalScore],
  r: rec,
  t: rationale,
  f: findings.filter(Boolean),
  k: risks.filter(Boolean),
});

// ── Encode: score(32) + contentHash(32) + summary(UTF-8) ─────────────────────
// Buffer is NOT available in the Chainlink DON; use Uint8Array + TextEncoder instead.
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
}

const scoreHex     = finalScore.toString(16).padStart(64, "0");
const headerBytes  = hexToBytes(scoreHex + hashHex);           // 64 bytes
const summaryBytes = new TextEncoder().encode(summary.slice(0, 192));

const result = new Uint8Array(headerBytes.length + summaryBytes.length);
result.set(headerBytes, 0);
result.set(summaryBytes, headerBytes.length);
return result;
