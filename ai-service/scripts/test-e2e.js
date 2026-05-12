/**
 * E2E Test: Project Application → AI Audit → Timelock → Fund Flow
 *
 * Usage:
 *   node scripts/test-e2e.js            # real MiniMax call
 *   node scripts/test-e2e.js --mock-ai  # fixed score 9000, no LLM cost
 *   node scripts/test-e2e.js --mock-ai --test-veto   # also test the veto path
 *
 * Prerequisites:
 *   1. npx hardhat node --port 8545
 *   2. npx hardhat run scripts/setup-e2e.ts --network localhost
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MultiAgentOrchestrator } from '../src/agents/multiAgentOrchestrator.js';

// ── Colour helpers ─────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m';
const B = '\x1b[1m', D = '\x1b[0m';
const ok   = (s) => console.log(`  ${G}✓${D}  ${s}`);
const fail = (s) => console.log(`  ${R}✗${D}  ${s}`);
const info = (s) => console.log(`  ${C}·${D}  ${s}`);
const step = (n, s) => console.log(`\n${B}[${n}]${D} ${s}`);
const fmt  = (n) => ethers.formatEther(n);

const MOCK_AI   = process.argv.includes('--mock-ai');
const TEST_VETO = process.argv.includes('--test-veto');

// ── ABIs ───────────────────────────────────────────────────────────────────
const IM_ABI = [
  'function submitProject(bytes32 commitHash, address contractAddr, string bizApi) returns (uint256)',
  'function fulfillAudit(uint256 projectId, uint256 score, uint256 scoreLow, uint256 scoreHigh, bytes32 reportHash, bytes[] nodeSignatures)',
  'function executeInvestment(uint256 projectId, uint256 amount, bytes vestingSchedule)',
  'function veto(uint256 projectId, uint256 reason)',
  'function projects(uint256) view returns (address applicant, bytes32 commitHash, address contractAddr, string bizApi, uint8 status, uint256 auditScore, uint256 auditScoreLow, uint256 auditScoreHigh, bytes32 auditReportHash, uint256 investmentAmount, uint256 releasedAmount, uint256 submittedAt, uint256 auditedAt, uint256 executionUnlocksAt, uint256 exitedAt, uint256 exitProceeds)',
  'function SCORE_THRESHOLD() view returns (uint256)',
  'event ProjectSubmitted(uint256 indexed projectId, address indexed applicant, bytes32 commitHash, address contractAddr)',
  'event ExecutionQueued(uint256 indexed projectId, uint256 unlocksAt, uint256 score)',
  'event ExecutionVetoed(uint256 indexed projectId, address indexed vetoer, uint256 reason)',
  'event InvestmentExecuted(uint256 indexed projectId, uint256 amount)',
];
const ATOKEN_ABI    = ['function balanceOf(address) view returns (uint256)'];
const FUND_TOKEN_ABI = ['function totalSupply() view returns (uint256)'];

// ProjectStatus enum (mirrors Solidity)
const STATUS = ['None','Pending','Auditing','PendingExecution','Rejected','Active','CircuitBroken','Exited','WriteOff','Vetoed'];

const MOCK_DECK_TEXT = `
# DecentraLend — Decentralized Lending Protocol on Arbitrum
## Problem
2 billion people are unbanked and cannot access traditional credit.
## Solution
Permissionless on-chain lending with automatic liquidation. No KYC. No credit scores.
## Market
DeFi lending TVL: $15B, growing 40% YoY.
## Team
Alice Chen (CEO) — ex-Aave core contributor | Bob Kumar (CTO) — ex-Chainlink, PhD MIT
## Traction
$2M TVL | 800 borrowers | CertiK 87/100 | Arbitrum Foundation partnership
## Tokenomics (DLEND, 1B supply)
40% community | 25% team 4yr vest | 20% treasury | 15% investors 2yr vest
## Roadmap
Q3 2025: mainnet | Q4 2025: multi-chain | Q1 2026: ZK credit scoring
`;

async function advanceTime(provider, seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

async function runScenario(label, provider, im, imOracle, imApplicant, imRiskAgent,
  aWeth, fundToken, wallets, contracts, aiScore, aiScoreLow, aiScoreHigh, aiReportHash, vetoThis,
  oracleNonceRef, riskAgentNonceRef) {

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`${B}  Scenario: ${label}${D}`);
  console.log('─'.repeat(56));

  // ── Initial state ────────────────────────────────────────────────────────
  step(0, 'Initial vault state');
  const tvlBefore          = await aWeth.balanceOf(contracts.fundVault);
  const applicantEthBefore = await provider.getBalance(wallets.applicant);
  info(`Vault TVL  : ${fmt(tvlBefore)} ETH`);
  info(`Applicant  : ${fmt(applicantEthBefore)} ETH`);

  // ── Submit project ────────────────────────────────────────────────────────
  step(1, 'Applicant submits project on-chain');
  const commitHash   = ethers.keccak256(ethers.toUtf8Bytes(`DecentraLend-${label}`));
  const contractAddr = '0x000000000000000000000000000000000000dEaD';
  const deckUrl      = 'mock://pitch-deck/decentra-lend';

  const submitTx      = await imApplicant.submitProject(commitHash, contractAddr, deckUrl);
  const submitReceipt = await submitTx.wait();
  ok(`Tx confirmed: ${submitReceipt.hash.slice(0, 18)}…`);

  const submittedEvent = submitReceipt.logs
    .map(log => { try { return im.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === 'ProjectSubmitted');

  const projectId = submittedEvent.args.projectId;
  ok(`Project ID : ${projectId}`);

  const pAfterSubmit = await im.projects(projectId);
  info(`Status: ${STATUS[Number(pAfterSubmit.status)]}`);

  // ── fulfillAudit ──────────────────────────────────────────────────────────
  step(3, 'Oracle calls fulfillAudit');
  const fulfillTx = await imOracle.fulfillAudit(
    projectId, aiScore, aiScoreLow, aiScoreHigh, aiReportHash, [],
    { nonce: oracleNonceRef.value++ }
  );
  const fulfillReceipt = await fulfillTx.wait();
  ok(`fulfillAudit confirmed: ${fulfillReceipt.hash.slice(0, 18)}…`);

  const pAfterAudit = await im.projects(projectId);
  info(`Status after audit : ${STATUS[Number(pAfterAudit.status)]}`);

  if (Number(pAfterAudit.status) === 4) { // Rejected
    ok(`Score ${aiScore} < 8000 → Rejected. No investment needed.`);
    return { projectId, finalStatus: 4, vetoUsed: false };
  }

  // Should be PendingExecution (3)
  const unlocksAt = pAfterAudit.executionUnlocksAt;
  info(`Timelock expires at: ${new Date(Number(unlocksAt) * 1000).toISOString()}`);

  const queuedEvent = fulfillReceipt.logs
    .map(log => { try { return im.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === 'ExecutionQueued');
  if (queuedEvent) ok(`ExecutionQueued: score=${queuedEvent.args.score}, unlocksAt=${queuedEvent.args.unlocksAt}`);

  // ── Veto (optional scenario) ───────────────────────────────────────────────
  if (vetoThis) {
    step('V', 'RISK_AGENT exercises veto (human override)');
    const vetoTx = await imRiskAgent.veto(projectId, 1, { nonce: riskAgentNonceRef.value++ }); // reason: 1=prompt-injection
    const vetoReceipt = await vetoTx.wait();
    ok(`veto() confirmed: ${vetoReceipt.hash.slice(0, 18)}…`);

    const pAfterVeto = await im.projects(projectId);
    info(`Status after veto: ${STATUS[Number(pAfterVeto.status)]}`);
    return { projectId, finalStatus: Number(pAfterVeto.status), vetoUsed: true };
  }

  // ── Advance time past timelock ────────────────────────────────────────────
  step(4, 'Advance blockchain time past 72h timelock');
  await advanceTime(provider, 72 * 3600 + 1);
  ok('Time advanced 72h + 1s');

  // ── executeInvestment ──────────────────────────────────────────────────────
  step(5, 'Oracle calls executeInvestment (timelock expired, not vetoed)');
  const investAmount = ethers.parseEther('1');
  info(`Investing ${fmt(investAmount)} ETH…`);

  const execTx = await imOracle.executeInvestment(projectId, investAmount, '0x', { nonce: oracleNonceRef.value++ });
  const execReceipt = await execTx.wait();
  ok(`executeInvestment confirmed: ${execReceipt.hash.slice(0, 18)}…`);

  const execEvent = execReceipt.logs
    .map(log => { try { return im.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === 'InvestmentExecuted');
  if (execEvent) ok(`InvestmentExecuted: ${fmt(execEvent.args.amount)} ETH`);

  const pFinal = await im.projects(projectId);
  info(`Final status: ${STATUS[Number(pFinal.status)]}`);

  // ── Final state diff ────────────────────────────────────────────────────────
  step(6, 'Final state');
  const tvlAfter          = await aWeth.balanceOf(contracts.fundVault);
  const applicantEthAfter = await provider.getBalance(wallets.applicant);
  info(`Vault TVL after : ${fmt(tvlAfter)} ETH (Δ ${fmt(tvlBefore - tvlAfter)} ETH)`);
  info(`Applicant ETH Δ : +${fmt(applicantEthAfter - applicantEthBefore)} ETH`);

  return { projectId, finalStatus: Number(pFinal.status), vetoUsed: false,
           tvlDelta: tvlBefore - tvlAfter, applicantDelta: applicantEthAfter - applicantEthBefore };
}

async function main() {
  const __dir   = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.join(__dir, '../../.e2e-state.json');

  if (!fs.existsSync(statePath)) {
    fail('Missing .e2e-state.json — run setup-e2e.ts first:');
    fail('  npx hardhat run scripts/setup-e2e.ts --network localhost');
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const { contracts, wallets, privateKeys, rpcUrl } = state;

  console.log('\n' + '='.repeat(56));
  console.log(`${B}  OmniVault E2E — Timelock + Veto${D}${MOCK_AI ? `  ${Y}[MOCK AI]${D}` : ''}`);
  console.log('='.repeat(56));
  console.log(`Mode      : ${MOCK_AI ? 'mock AI (score 9000)' : 'real MiniMax LLM'}`);
  console.log(`Test veto : ${TEST_VETO ? `${Y}yes${D}` : 'no'}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const oracleWallet    = new ethers.Wallet(privateKeys.oracle,    provider);
  const applicantWallet = new ethers.Wallet(privateKeys.applicant, provider);
  // Use deployer as riskAgent (has RISK_AGENT_ROLE from setup-e2e.ts)
  const deployerKey     = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const riskAgentWallet = new ethers.Wallet(deployerKey, provider);

  const im          = new ethers.Contract(contracts.investmentManager, IM_ABI, provider);
  const imOracle    = im.connect(oracleWallet);
  const imApplicant = im.connect(applicantWallet);
  const imRiskAgent = im.connect(riskAgentWallet);
  const aWeth       = new ethers.Contract(contracts.aWeth,      ATOKEN_ABI,     provider);
  const fundToken   = new ethers.Contract(contracts.fundToken,  FUND_TOKEN_ABI, provider);

  // ── Determine AI scores ──────────────────────────────────────────────────
  let aiScore, aiScoreLow, aiScoreHigh, aiReportHash;

  step(2, MOCK_AI ? 'AI audit (mock)' : 'AI audit via MiniMax-M2.7');

  if (MOCK_AI) {
    aiScore      = 9000;
    aiScoreLow   = 8500;
    aiScoreHigh  = 9500;
    aiReportHash = ethers.keccak256(ethers.toUtf8Bytes('mock-report-decentra-lend'));
    ok(`Mock score: ${aiScore} / 10000`);
  } else {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-填')) {
      fail('OPENAI_API_KEY not set. Use --mock-ai or edit ai-service/.env');
      process.exit(1);
    }
    console.log('  Running 3-agent pipeline…');
    const t0 = Date.now();
    const orchestrator = new MultiAgentOrchestrator();
    const result = await orchestrator.runAudit({
      deckHash: ethers.id('mock://decentra-lend'),
      deckUrl: 'mock://decentra-lend',
      projectId: 1,
      projectName: 'DecentraLend',
      applicant: wallets.applicant,
      _deckText: MOCK_DECK_TEXT,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    aiScore      = result.score;
    aiScoreLow   = result.scoreLow;
    aiScoreHigh  = result.scoreHigh;
    aiReportHash = result.reportHash.startsWith('0x') && result.reportHash.length === 66
      ? result.reportHash
      : ethers.id(result.reportHash);
    ok(`Score: ${aiScore} / 10000  [${aiScoreLow}, ${aiScoreHigh}]  (${elapsed}s)`);
    info(`Agents: ${result.agentsUsed.join(', ')}`);
  }

  const approvalPath = aiScore >= 8000;
  info(`Recommendation: ${approvalPath ? `${G}APPROVED → enters PendingExecution${D}` : `${R}REJECTED${D}`}`);

  // Shared nonce refs — manually track to avoid Hardhat evm_mine cache bug
  const oracleNonceRef    = { value: await provider.getTransactionCount(wallets.oracle,           'pending') };
  const riskAgentNonceRef = { value: await provider.getTransactionCount(riskAgentWallet.address,  'pending') };

  // ══ Scenario A — happy path (or rejection) ═══════════════════════════════
  const resultA = await runScenario(
    approvalPath ? 'Approved → execute after timelock' : 'Rejected',
    provider, im, imOracle, imApplicant, imRiskAgent,
    aWeth, fundToken, { ...wallets, riskAgent: riskAgentWallet.address }, contracts,
    aiScore, aiScoreLow, aiScoreHigh, aiReportHash,
    false, oracleNonceRef, riskAgentNonceRef
  );

  // ══ Scenario B — veto path (only with --test-veto and passing AI score) ══
  let resultB = null;
  if (TEST_VETO && approvalPath) {
    resultB = await runScenario(
      'Approved → RISK_AGENT vetoes',
      provider, im, imOracle, imApplicant, imRiskAgent,
      aWeth, fundToken, { ...wallets, riskAgent: riskAgentWallet.address }, contracts,
      aiScore, aiScoreLow, aiScoreHigh, aiReportHash,
      true, oracleNonceRef, riskAgentNonceRef
    );
  }

  // ── Assertions ─────────────────────────────────────────────────────────────
  step('✓', 'Assertions');
  let passed = 0, failed = 0;

  function assert(cond, msg) {
    if (cond) { ok(msg); passed++; } else { fail(`FAIL: ${msg}`); failed++; }
  }

  // Scenario A assertions
  if (!approvalPath) {
    assert(resultA.finalStatus === 4, 'Rejected project has status = Rejected (4)');
  } else {
    assert(resultA.finalStatus === 5, 'Approved project → Active (5) after execution');
    assert(resultA.tvlDelta > 0n,     'Vault TVL decreased after investment');
    assert(resultA.applicantDelta > 0n, 'Applicant received ETH');
  }

  // Scenario B (veto) assertions
  if (resultB) {
    assert(resultB.finalStatus === 9,   'Vetoed project has status = Vetoed (9)');
    assert(resultB.vetoUsed === true,   'Veto path was exercised');
  }

  console.log('\n' + '='.repeat(56));
  if (failed === 0) {
    console.log(`${G}${B}  All ${passed} assertions passed. E2E test complete!${D}`);
  } else {
    console.log(`${R}${B}  ${failed} assertion(s) FAILED, ${passed} passed.${D}`);
    process.exit(1);
  }
  console.log('='.repeat(56) + '\n');
}

main().catch(e => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});
