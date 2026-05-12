/**
 * Layer 2: Full orchestrator integration test
 * Usage: node scripts/test-orchestrator.js [deckUrl]
 *
 * If deckUrl is omitted, uses an inline mock deck (no network fetch).
 * Runs the complete pipeline: 3 agents → consensus → report generation.
 */
import 'dotenv/config';
import { MultiAgentOrchestrator } from '../src/agents/multiAgentOrchestrator.js';
import { fetchPitchDeck } from '../src/utils/pitchDeckFetcher.js';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const MOCK_DECK_TEXT = `
# DecentraLend — Decentralized Lending Protocol on Arbitrum

## Problem
2 billion people are unbanked and cannot access traditional credit.

## Solution
Permissionless on-chain lending with automatic liquidation. No KYC. No credit scores.
Supports ETH, WBTC, and USDC as collateral.

## Market
DeFi lending TVL: $15B, growing 40% YoY. Primary targets: SEA and LatAm.

## Team
Alice Chen (CEO) — ex-Aave core contributor, 6 yrs DeFi
Bob Kumar (CTO) — ex-Chainlink, PhD MIT
4 engineers, 2 advisors from a16z crypto

## Traction
$2M TVL in closed beta | 800 active borrowers | CertiK audit 87/100 | Arbitrum Foundation partnership

## Tokenomics (DLEND, 1B supply)
40% community/LM | 25% team 4yr vest | 20% treasury | 15% investors 2yr vest
Revenue: 0.5% origination fee + 10% interest spread → buyback & burn

## Roadmap
Q3 2025: mainnet | Q4 2025: multi-chain | Q1 2026: ZK credit scoring
`;

function bar(score, max = 100, width = 20) {
  const filled = Math.round((score / max) * width);
  const color = score >= 70 ? GREEN : score >= 40 ? YELLOW : RED;
  return color + '█'.repeat(filled) + '░'.repeat(width - filled) + RESET;
}

async function main() {
  const deckUrl = process.argv[2] ?? null;

  console.log(`\n${BOLD}OmniVault — Full Audit Pipeline Test${RESET}`);
  console.log(`Model  : ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
  console.log(`Deck   : ${deckUrl ?? '(inline mock pitch deck)'}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-填')) {
    console.error(`${RED}✗ OPENAI_API_KEY not set. Edit ai-service/.env first.${RESET}`);
    process.exit(1);
  }

  const orchestrator = new MultiAgentOrchestrator();

  // Determine deck content
  let _deckText = null;
  if (deckUrl) {
    console.log('Fetching deck from URL…');
    const fetched = await fetchPitchDeck(deckUrl);
    if (fetched.text) {
      _deckText = fetched.text;
      console.log(`Fetched ${fetched.text.length} chars (${fetched.contentType})\n`);
    } else {
      console.warn(`${YELLOW}⚠ Could not fetch URL, agents will note limited data.${RESET}\n`);
    }
  } else {
    _deckText = MOCK_DECK_TEXT;
  }

  const t0 = Date.now();
  let result;
  try {
    result = await orchestrator.runAudit({
      deckHash: '0xmockhash1234',
      deckUrl: deckUrl ?? 'mock://inline',
      projectId: 999,
      projectName: 'DecentraLend (test)',
      applicant: '0x0000000000000000000000000000000000000001',
      _deckText,
    });
  } catch (err) {
    console.error(`${RED}✗ Audit failed: ${err.message}${RESET}`);
    if (err.status === 401) console.error('  → Invalid API key');
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const score = result.score;
  const rec = score >= 8000 ? `${GREEN}APPROVED${RESET}`
    : score >= 6000 ? `${YELLOW}REVIEW_REQUIRED${RESET}`
    : score >= 4000 ? `${YELLOW}CONDITIONAL_APPROVAL${RESET}`
    : `${RED}REJECTED${RESET}`;

  console.log(`${BOLD}${CYAN}━━━ AUDIT RESULTS ━━━${RESET}`);
  console.log(`\n  Final Score    : ${BOLD}${score}${RESET} / 10000  ${bar(score / 100)}`);
  console.log(`  Score Range    : [${result.scoreLow}, ${result.scoreHigh}]`);
  console.log(`  Recommendation : ${rec}`);
  console.log(`  Report Hash    : ${result.reportHash.substring(0, 16)}…`);
  console.log(`  Agents Used    : ${result.agentsUsed.join(', ')}`);
  console.log(`  Elapsed        : ${elapsed}s`);

  console.log(`\n${BOLD}${CYAN}━━━ AGENT BREAKDOWN ━━━${RESET}`);

  const pd = result.agentResults.pitchDeckAnalysis;
  const ra = result.agentResults.riskAssessment;
  const ba = result.agentResults.businessAnalysis;

  if (pd && !pd.error) {
    console.log(`\n  ${BOLD}PitchDeckAnalysisAgent${RESET}`);
    console.log(`    Overall  : ${pd.overallScore}/100  ${bar(pd.overallScore)}`);
    console.log(`    Red flags: ${pd.redFlags ? RED + 'YES' + RESET : GREEN + 'no' + RESET}`);
    if (pd.scores) {
      for (const [k, v] of Object.entries(pd.scores)) {
        console.log(`    ${k.padEnd(22)}: ${String(v).padStart(3)}  ${bar(v)}`);
      }
    }
    if (pd.strengths?.length) console.log(`    Strengths: ${pd.strengths.join(' · ')}`);
    if (pd.concerns?.length)  console.log(`    Concerns : ${pd.concerns.join(' · ')}`);
  }

  if (ra && !ra.error) {
    console.log(`\n  ${BOLD}RiskAssessmentAgent${RESET}`);
    console.log(`    Risk     : ${ra.overallRiskScore}/100 (${ra.riskLevel})  ${bar(100 - ra.overallRiskScore)} (inverted)`);
    if (ra.categories) {
      for (const [k, v] of Object.entries(ra.categories)) {
        console.log(`    ${k.padEnd(22)}: ${String(v).padStart(3)}  ${bar(100 - v)} (inverted)`);
      }
    }
    if (ra.topRisks?.length) console.log(`    Top Risks: ${ra.topRisks.join(' · ')}`);
  }

  if (ba && !ba.error) {
    console.log(`\n  ${BOLD}BusinessAnalysisAgent${RESET}`);
    console.log(`    Sustain  : ${ba.sustainabilityScore}/100  ${bar(ba.sustainabilityScore)}`);
    if (ba.dimensions) {
      for (const [k, v] of Object.entries(ba.dimensions)) {
        console.log(`    ${k.padEnd(22)}: ${String(v).padStart(3)}  ${bar(v)}`);
      }
    }
    if (ba.highlights?.length) console.log(`    Highlights: ${ba.highlights.join(' · ')}`);
  }

  console.log(`\n${GREEN}${BOLD}Pipeline test complete.${RESET}\n`);
}

main();
