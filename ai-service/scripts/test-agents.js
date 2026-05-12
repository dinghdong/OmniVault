/**
 * Layer 1: Individual agent smoke tests
 * Usage: node scripts/test-agents.js [agent]
 *   agent: pitch | risk | business | all (default: all)
 *
 * Each agent receives an inline mock pitch deck summary — no URL fetching.
 * Cost: ~$0.01-0.03 total for all three agents.
 */
import 'dotenv/config';
import { PitchDeckAnalysisAgent } from '../src/agents/pitchDeckAnalysisAgent.js';
import { RiskAssessmentAgent } from '../src/agents/riskAssessmentAgent.js';
import { BusinessAnalysisAgent } from '../src/agents/businessAnalysisAgent.js';

// ── Sample pitch deck summary (inline, no URL needed) ─────────────────────────
const MOCK_DECK_SUMMARY = `
# DecentraLend — Decentralized Lending Protocol

## Problem
Traditional lending requires credit scores and banks. 2B unbanked people have no access to credit.

## Solution
DecentraLend is a permissionless lending protocol on Arbitrum. Users collateralize ETH/USDC to borrow.
Smart contracts handle liquidations automatically. No credit checks. No KYC.

## Market
DeFi lending market: $15B TVL. Growing 40% YoY. We target underbanked markets in SEA and LatAm.

## Team
- CEO: Alice Chen — ex-Aave core contributor, 6 years DeFi
- CTO: Bob Kumar — ex-Chainlink, PhD Computer Science MIT
- 4 additional engineers, 2 advisors from a16z crypto

## Traction
- $2M TVL in closed beta (3 months)
- 800 active borrowers
- Audited by CertiK (score: 87/100)
- Partnership with Arbitrum Foundation confirmed

## Tokenomics
- DLEND token: 1B total supply
- 40% community/liquidity mining, 25% team (4yr vest), 20% treasury, 15% investors (2yr vest)
- Utility: governance votes, fee discounts, staking rewards from protocol revenue
- Revenue model: 0.5% origination fee + 10% of interest spread → token buyback & burn

## Roadmap
Q3 2025: Mainnet launch | Q4 2025: Multi-chain | Q1 2026: Undercollateralized lending (credit scoring via ZK proofs)
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function section(title) {
  console.log(`\n${BOLD}${CYAN}━━━ ${title} ━━━${RESET}`);
}

function ok(label, value) {
  console.log(`  ${GREEN}✓${RESET} ${label}: ${BOLD}${value}${RESET}`);
}

function info(label, value) {
  console.log(`  ${YELLOW}·${RESET} ${label}: ${value}`);
}

function printJson(obj, indent = 4) {
  console.log(JSON.stringify(obj, null, indent)
    .split('\n')
    .map(l => '  ' + l)
    .join('\n'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function testPitchDeckAgent() {
  section('PitchDeckAnalysisAgent');
  const agent = new PitchDeckAnalysisAgent();

  // Inject mock deck content directly by overriding _buildDeckContext
  const originalBuild = agent._buildDeckContext.bind(agent);
  agent._buildDeckContext = (deck) => {
    if (!deck.text) {
      deck.text = MOCK_DECK_SUMMARY;
      deck.contentType = 'text/plain (mock)';
    }
    return originalBuild(deck);
  };

  const t0 = Date.now();
  const result = await agent.analyze({ deckUrl: 'mock://pitch-deck', deckHash: '0xdeadbeef', projectId: 1 });
  const ms = Date.now() - t0;

  ok('Status', result.status);
  ok('Overall Score', `${result.overallScore}/100`);
  ok('Red Flags', result.redFlags ? `${RED}YES${RESET}` : `${GREEN}NO${RESET}`);
  info('Dimension Scores', '');
  printJson(result.scores);
  info('Strengths', result.strengths.join(' | '));
  info('Concerns', result.concerns.join(' | '));
  info('Time', `${ms}ms`);

  return result;
}

async function testRiskAgent(deckSummary) {
  section('RiskAssessmentAgent');
  const agent = new RiskAssessmentAgent();

  const t0 = Date.now();
  const result = await agent.assess({ deckSummary: deckSummary ?? MOCK_DECK_SUMMARY, projectId: 1 });
  const ms = Date.now() - t0;

  ok('Status', result.status);
  ok('Overall Risk Score', `${result.overallRiskScore}/100 (${result.riskLevel})`);
  info('Confidence Interval', `[${result.scoreLow}, ${result.scoreHigh}]`);
  info('Risk Categories', '');
  printJson(result.categories);
  info('Top Risks', result.topRisks.join(' | '));
  info('Time', `${ms}ms`);

  return result;
}

async function testBusinessAgent(deckSummary) {
  section('BusinessAnalysisAgent');
  const agent = new BusinessAnalysisAgent();

  const t0 = Date.now();
  const result = await agent.analyze({ deckSummary: deckSummary ?? MOCK_DECK_SUMMARY, projectId: 1 });
  const ms = Date.now() - t0;

  ok('Status', result.status);
  ok('Sustainability Score', `${result.sustainabilityScore}/100`);
  info('Confidence Interval', `[${result.scoreLow}, ${result.scoreHigh}]`);
  info('Dimensions', '');
  printJson(result.dimensions);
  info('Highlights', result.highlights.join(' | '));
  info('Time', `${ms}ms`);

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const target = process.argv[2] ?? 'all';

  console.log(`${BOLD}OmniVault Agent Smoke Tests${RESET}`);
  console.log(`Model: ${process.env.OPENAI_MODEL || 'gpt-4o'} | Target: ${target}`);

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-填')) {
    console.error(`\n${RED}✗ OPENAI_API_KEY not set. Edit ai-service/.env first.${RESET}`);
    process.exit(1);
  }

  try {
    if (target === 'pitch' || target === 'all') await testPitchDeckAgent();
    if (target === 'risk'  || target === 'all') await testRiskAgent();
    if (target === 'business' || target === 'all') await testBusinessAgent();

    console.log(`\n${GREEN}${BOLD}All tests passed.${RESET}\n`);
  } catch (err) {
    console.error(`\n${RED}✗ Test failed: ${err.message}${RESET}`);
    if (err.status === 401) console.error('  → Invalid API key');
    if (err.status === 429) console.error('  → Rate limit hit, retry in a moment');
    process.exit(1);
  }
}

main();
