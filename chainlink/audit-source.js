// ─────────────────────────────────────────────────────────────────────────────
// OmniVault — Chainlink Functions AI Audit Source  (A2A multi-dimension)
// Runs inside the Chainlink DON (Decentralized Oracle Network).
//
// args:    [0] projectId      (string)
//          [1] sourceCodeHash (hex string — keccak256 of project commit)
//          [2] bizApi         (URL or description of the project)
// secrets: ZG_API_KEY, ZG_BASE_URL
//
// Response format (160 bytes — 5 ABI-encoded words):
//   word 0  (  0– 31): finalScore   uint256  composite [0,100]  (40%×R + 30%×Q + 30%×M)
//   word 1  ( 32– 63): reliability  uint256  [0,100]  — agent uptime / audit track-record
//   word 2  ( 64– 95): quality      uint256  [0,100]  — code & product quality
//   word 3  ( 96–127): marketFit    uint256  [0,100]  — market traction / product-market fit
//   word 4  (128–159): contentHash  bytes32  SHA-256 of full audit log
//
// Threshold for APPROVE: finalScore >= 60.
// ─────────────────────────────────────────────────────────────────────────────

const projectId      = args[0];
const sourceCodeHash = args[1];
const bizApi         = args[2];

const BASE   = secrets.ZG_BASE_URL || "https://router-api-testnet.integratenetwork.work/v1";
const APIKEY = secrets.ZG_API_KEY;
if (!APIKEY) throw new Error("ZG_API_KEY DON-hosted secret not configured");
const MODEL  = "qwen/qwen-2.5-7b-instruct";

// ── A2A Multi-agent audit prompt ─────────────────────────────────────────────
// Three agent axes map to the OmniVault ScoringEngine weights:
//   reliability  → 40% weight  (on-chain security, agent consistency, audit history)
//   quality      → 30% weight  (code quality, documentation, test coverage)
//   marketFit    → 30% weight  (market traction, tokenomics, competitive position)
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
      content: `You are an A2A (Agent-to-Agent) AI investment committee for OmniVault, a decentralized VC fund.
You evaluate Web3 projects across THREE dimensions that match our on-chain ScoringEngine weights.

Project ID: ${projectId}
Commit hash: ${sourceCodeHash}
Project info: ${bizApi || "No additional info provided."}

Perform a 3-dimension audit and respond ONLY with valid JSON (no markdown, no extra text):
{
  "reliabilityScore": <0-100, smart contract security, audit history, agent reliability>,
  "qualityScore": <0-100, code quality, documentation, test coverage, architecture>,
  "marketFitScore": <0-100, market traction, tokenomics, competitive position, user adoption>,
  "reliabilityFindings": ["<finding1>", "<finding2>"],
  "qualityFindings": ["<finding1>", "<finding2>"],
  "marketFindings": ["<finding1>", "<finding2>"],
  "recommendation": "<APPROVE or REJECT>",
  "rationale": "<one concise sentence (max 120 chars) explaining the decision>"
}

Scoring weights: reliability=40%, quality=30%, marketFit=30%.
Threshold for APPROVE: weightedScore >= 60.`,
    }],
    max_tokens: 600,
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

// 3D dimension scores
const reliability = safeNum(parsed, "reliabilityScore", 50);
const quality     = safeNum(parsed, "qualityScore",     50);
const marketFit   = safeNum(parsed, "marketFitScore",   50);

// Composite score: 40% reliability + 30% quality + 30% marketFit
// Matches OmniVault ScoringEngine default weights (4000/3000/3000 / 10000)
const finalScore = Math.min(100, Math.round(
  (reliability * 4000 + quality * 3000 + marketFit * 3000) / 10000
));

const rec      = safeStr(parsed, "recommendation", "UNKNOWN");
const rationale = safeStr(parsed, "rationale", "").slice(0, 120);
const rFindings = safeArr(parsed, "reliabilityFindings").map(f => String(f).slice(0, 60));
const qFindings = safeArr(parsed, "qualityFindings").map(f => String(f).slice(0, 60));
const mFindings = safeArr(parsed, "marketFindings").map(f => String(f).slice(0, 60));

// ── Content hash: SHA-256 of full audit log ───────────────────────────────────
const auditLog = JSON.stringify({
  projectId, sourceCodeHash, model: MODEL, raw,
  scores: { reliability, quality, marketFit, finalScore },
});
const hashBuf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auditLog));
const hashHex  = Array.from(new Uint8Array(hashBuf))
  .map(b => b.toString(16).padStart(2, "0")).join("");

// ── Encode: 5 × 32-byte ABI words = 160 bytes ────────────────────────────────
// word 0: finalScore   (uint256 big-endian)
// word 1: reliability  (uint256 big-endian)
// word 2: quality      (uint256 big-endian)
// word 3: marketFit    (uint256 big-endian)
// word 4: contentHash  (bytes32)
//
// Buffer is NOT available in the Chainlink DON; use Uint8Array + TextEncoder.
function numToWord(n) {
  const hex = Math.floor(n).toString(16).padStart(64, "0");
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}
function hexToBytes32(hex) {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}

const result = new Uint8Array(160);
result.set(numToWord(finalScore),   0);    // word 0
result.set(numToWord(reliability), 32);    // word 1
result.set(numToWord(quality),     64);    // word 2
result.set(numToWord(marketFit),   96);    // word 3
result.set(hexToBytes32(hashHex), 128);    // word 4

return result;
