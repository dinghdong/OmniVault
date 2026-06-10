/**
 * E2E Local — deploys the CURRENT ETH-only architecture to a running Hardhat
 * node, exercises the full investment lifecycle with assertions, and leaves
 * the chain in a rich demo state for the frontend.
 *
 * Usage:
 *   Terminal 1: npx hardhat node --port 8545
 *   Terminal 2: npx hardhat run scripts/e2e-local.ts --network localhost
 *
 * Accounts:
 *   [0] deployer — admin, RISK_AGENT
 *   [1] lp       — deposits 5 ETH
 *   [2] oracle   — (reserved; mock oracle is settled permissionlessly)
 *   [3] applicant— AI agent submitting projects
 *   [5..7]       — revenue-share agent wallets
 *
 * Writes .e2e-state.json to repo root for the Playwright specs.
 */
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ETH = ethers.parseEther;
const fmt = (n: bigint) => ethers.formatEther(n);

let stepNo = 0;
function step(msg: string) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${msg}`);
}
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = typeof actual === 'bigint' ? actual.toString() : String(actual);
  const e = typeof expected === 'bigint' ? expected.toString() : String(expected);
  if (a !== e) throw new Error(`ASSERT FAIL [${label}]: expected ${e}, got ${a}`);
  console.log(`  ✓ ${label} = ${a}`);
}
function assertClose(actual: bigint, expected: bigint, tol: bigint, label: string) {
  const diff = actual > expected ? actual - expected : expected - actual;
  if (diff > tol)
    throw new Error(`ASSERT FAIL [${label}]: expected ~${fmt(expected)}, got ${fmt(actual)} (diff ${fmt(diff)})`);
  console.log(`  ✓ ${label} ≈ ${fmt(actual)} ETH`);
}
function assertGt(a: bigint, b: bigint, label: string) {
  if (a <= b) throw new Error(`ASSERT FAIL [${label}]: ${a} <= ${b}`);
  console.log(`  ✓ ${label} (${fmt(a)} > ${fmt(b)})`);
}
async function increaseTime(seconds: number) {
  await network.provider.send('evm_increaseTime', [seconds]);
  await network.provider.send('evm_mine');
}

const TIMELOCK = 3 * 60;          // InvestmentManager.EXECUTION_DELAY
const WEEK = 7 * 24 * 3600;

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, lp, , applicant] = signers;
  const agentW1 = signers[5], agentW2 = signers[6], agentW3 = signers[7];
  const net = await ethers.provider.getNetwork();

  console.log('='.repeat(56));
  console.log('  OmniVault E2E — local full-lifecycle test');
  console.log('='.repeat(56));
  console.log(`Chain ID  : ${net.chainId}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`LP        : ${lp.address}`);
  console.log(`Applicant : ${applicant.address}`);

  // ── Deploy ──────────────────────────────────────────────────────────────────
  step('Deploy contracts (current ETH-only architecture)');

  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();

  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(await fundToken.getAddress());
  await fundVault.waitForDeployment();

  const MockOracle = await ethers.getContractFactory('MockOmniOracleV2');
  const mockOracle = await MockOracle.deploy();
  await mockOracle.waitForDeployment();

  const IM = await ethers.getContractFactory('InvestmentManager');
  const im = await IM.deploy(await fundVault.getAddress(), 60);
  await im.waitForDeployment();

  const NFA = await ethers.getContractFactory('NonFungibleAgent');
  const nfa = await NFA.deploy();
  await nfa.waitForDeployment();

  const RevenueShare = await ethers.getContractFactory('RevenueShare');
  const rs = await RevenueShare.deploy();
  await rs.waitForDeployment();

  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const at = await AuditTrail.deploy();
  await at.waitForDeployment();

  const PromptRegistry = await ethers.getContractFactory('PromptRegistry');
  const pr = await PromptRegistry.deploy(deployer.address);
  await pr.waitForDeployment();

  const DMS = await ethers.getContractFactory('DeadManSwitch');
  const dms = await DMS.deploy();
  await dms.waitForDeployment();

  for (const [name, c] of Object.entries({
    FundToken: fundToken, FundVault: fundVault, MockOmniOracleV2: mockOracle,
    InvestmentManager: im, NonFungibleAgent: nfa, RevenueShare: rs,
    AuditTrail: at, PromptRegistry: pr, DeadManSwitch: dms,
  })) {
    console.log(`  ${name.padEnd(18)} ${await (c as any).getAddress()}`);
  }

  // ── Wire roles ──────────────────────────────────────────────────────────────
  step('Wire roles & oracle');
  await fundToken.grantRole(await fundToken.MINTER_ROLE(), await fundVault.getAddress());
  await fundToken.grantRole(await fundToken.BURNER_ROLE(), await fundVault.getAddress());
  await fundVault.grantRole(await fundVault.INVESTOR_ROLE(), await im.getAddress());
  await im.setOracle(await mockOracle.getAddress());
  await im.grantRole(await im.RISK_AGENT_ROLE(), deployer.address);
  await at.grantRole(await at.AI_ORACLE_ROLE(), deployer.address);
  // DeadManSwitch ↔ InvestmentManager wiring (A6)
  await dms.setInvestmentManager(await im.getAddress());
  await im.grantRole(await im.RISK_AGENT_ROLE(), await dms.getAddress());
  // RevenueShare: 3 audit agents, 40/30/30
  await rs.registerAgent('did:nfa:agent:code',   'CodeAnalysis',     4000, agentW1.address);
  await rs.registerAgent('did:nfa:agent:risk',   'RiskAssessment',   3000, agentW2.address);
  await rs.registerAgent('did:nfa:agent:market', 'BusinessAnalysis', 3000, agentW3.address);
  console.log('  roles + DMS wiring + 3 revenue agents ✓');

  // ── 1. LP deposits ──────────────────────────────────────────────────────────
  step('LP deposits 5 ETH');
  await (await fundVault.connect(lp).deposit({ value: ETH('5') })).wait();
  assertEq(await fundToken.getShares(lp.address), ETH('5'), 'LP shares');
  assertEq(await fundVault.vaultBalance(), ETH('5'), 'vault ETH');

  // ── 2. Agent identity (NFA) ────────────────────────────────────────────────
  step('Applicant mints NFA agent identity');
  await (await nfa.connect(applicant).mint(
    'github.com/omnivault/agent-alpha',
    'https://agent-alpha.example.com/a2a',
    'claude-sonnet-4-6'
  )).wait();
  const did = await nfa.getDid(1);
  if (!did.startsWith(`did:nfa:${net.chainId}:`)) throw new Error(`bad DID: ${did}`);
  console.log(`  ✓ NFA #1 DID = ${did}`);

  // ── 3. Project 1: full happy path ──────────────────────────────────────────
  step('P1 submit (requests 1 ETH) → Auditing');
  await (await im.connect(applicant).submitProject(
    ethers.id('p1-commit'), applicant.address, 'https://defi-yield-agent.example.com',
    ETH('1'), did, 'github.com/omnivault/agent-alpha', 'https://agent-alpha.example.com/a2a'
  )).wait();
  const p1 = await im.projectCount();
  assertEq((await im.projects(p1)).status, 2n, 'P1 status Auditing');
  assertEq(await mockOracle.lastRequestedProjectId(), p1, 'oracle received request');

  step('P1 oracle scores 82 (85/80/78) → settleAudit → PendingExecution');
  await (await mockOracle.setResult(p1, 83n, 85, 80, 78, ethers.id('p1-audit-log'))).wait();
  await (await im.settleAudit(p1)).wait();
  assertEq((await im.projects(p1)).status, 3n, 'P1 status PendingExecution');
  const s1 = await im.getAuditScores(p1);
  assertEq(s1[0], 82n, 'P1 finalScore');

  step('Timelock passes → executeInvestment(1 ETH) → 20% upfront');
  await increaseTime(TIMELOCK + 1);
  const applicantBefore = await ethers.provider.getBalance(applicant.address);
  await (await im.connect(deployer).executeInvestment(p1, ETH('1'), '0x')).wait();
  const applicantAfter = await ethers.provider.getBalance(applicant.address);
  assertEq(applicantAfter - applicantBefore, ETH('0.2'), 'upfront 0.2 ETH');
  assertEq(await fundVault.vaultBalance(), ETH('4'), 'vault 4 ETH after divest');
  assertEq((await im.projects(p1)).status, 5n, 'P1 status Active');

  step('26 weeks pass → claimPayout vests ~0.4 ETH');
  await increaseTime(26 * WEEK);
  const claimable = await im.getClaimableAmount(p1);
  assertClose(claimable, ETH('0.4'), ETH('0.001'), 'claimable');
  const beforeClaim = await ethers.provider.getBalance(applicant.address);
  await (await im.connect(deployer).claimPayout(p1)).wait();
  assertClose(
    (await ethers.provider.getBalance(applicant.address)) - beforeClaim,
    ETH('0.4'), ETH('0.001'), 'claimed payout'
  );

  step('P1 profitable exit (+30%) → LP balances rebase up');
  await (await im.simulateExit(p1, 13000)).wait();
  assertEq((await im.projects(p1)).status, 7n, 'P1 status Exited');
  assertEq(await fundToken.accrualFactor(), ETH('1.06'), 'accrualFactor 1.06');
  assertEq(await fundToken.balanceOf(lp.address), ETH('5.3'), 'LP balance 5.3 ETH');

  step('LP redeems 1.0 shares → receives 1.06 ETH (yield included)');
  const lpEthBefore = await ethers.provider.getBalance(lp.address);
  const rtx = await (await fundVault.connect(lp).redeem(ETH('1'))).wait();
  const gas = rtx!.gasUsed * rtx!.gasPrice;
  assertEq(
    (await ethers.provider.getBalance(lp.address)) - lpEthBefore + gas,
    ETH('1.06'), 'redeemed 1.06 ETH'
  );
  assertEq(await fundToken.getShares(lp.address), ETH('4'), 'LP shares left');

  // ── 4. Project 2: rejection ─────────────────────────────────────────────────
  step('P2 submit → oracle scores 45 → Rejected');
  await (await im.connect(applicant).submitProject(
    ethers.id('p2-commit'), applicant.address, 'https://meme-casino.example.com',
    ETH('2'), did, 'github.com/example/casino', 'https://casino.example.com/api'
  )).wait();
  const p2 = await im.projectCount();
  await (await mockOracle.setResult(p2, 46n, 40, 45, 50, ethers.id('p2-audit-log'))).wait();
  await (await im.settleAudit(p2)).wait();
  assertEq((await im.projects(p2)).status, 4n, 'P2 status Rejected');

  // ── 5. Project 3: LP veto ───────────────────────────────────────────────────
  step('P3 submit → approved 75 → LP vetoes during timelock');
  await (await im.connect(applicant).submitProject(
    ethers.id('p3-commit'), applicant.address, 'https://suspicious-bridge.example.com',
    ETH('1.5'), did, 'github.com/example/bridge', 'https://bridge.example.com/api'
  )).wait();
  const p3 = await im.projectCount();
  await (await mockOracle.setResult(p3, 76n, 75, 74, 77, ethers.id('p3-audit-log'))).wait();
  await (await im.settleAudit(p3)).wait();
  await (await im.connect(lp).veto(p3)).wait();
  assertEq((await im.projects(p3)).status, 9n, 'P3 status Vetoed');

  // ── 6. Project 4: dead-man switch write-off ────────────────────────────────
  step('P4 (0.2 ETH) executed → DMS registered → 61 days silent → WriteOff');
  await (await im.connect(applicant).submitProject(
    ethers.id('p4-commit'), applicant.address, 'https://ghost-protocol.example.com',
    ETH('0.2'), did, 'github.com/example/ghost', 'https://ghost.example.com/api'
  )).wait();
  const p4 = await im.projectCount();
  await (await mockOracle.setResult(p4, 71n, 70, 68, 72, ethers.id('p4-audit-log'))).wait();
  await (await im.settleAudit(p4)).wait();
  await increaseTime(TIMELOCK + 1);
  await (await im.executeInvestment(p4, ETH('0.2'), '0x')).wait();
  await (await dms.registerProject(p4)).wait();

  const factorBefore = await fundToken.accrualFactor();
  await increaseTime(61 * 24 * 3600);
  await (await dms.triggerDeadSwitch(p4)).wait();          // permissionless
  assertEq((await im.projects(p4)).status, 8n, 'P4 status WriteOff (via DMS)');
  assertEq((await dms.watches(p4)).active, false, 'DMS watch deactivated');
  const factorAfter = await fundToken.accrualFactor();
  assertGt(factorBefore, factorAfter, 'accrualFactor dropped on write-off');

  // ── 7. Project 5: fresh PendingExecution (live veto window for the UI) ─────
  step('P5 submit → approved 88 → left in PendingExecution');
  await (await im.connect(applicant).submitProject(
    ethers.id('p5-commit'), applicant.address, 'https://zk-ml-rollup.example.com',
    ETH('0.8'), did, 'github.com/omnivault/agent-alpha', 'https://agent-alpha.example.com/a2a'
  )).wait();
  const p5 = await im.projectCount();
  await (await mockOracle.setResult(p5, 89n, 90, 88, 86, ethers.id('p5-audit-log'))).wait();
  await (await im.settleAudit(p5)).wait();
  assertEq((await im.projects(p5)).status, 3n, 'P5 status PendingExecution');

  // ── 8. Revenue share to AI agents ──────────────────────────────────────────
  step('RevenueShare: deposit 0.1 ETH → CodeAnalysis agent claims 40%');
  await (await rs.depositRevenue({ value: ETH('0.1') })).wait();
  assertEq(await rs.pendingRevenue(1), ETH('0.04'), 'agent1 pending 0.04');
  const w1Before = await ethers.provider.getBalance(agentW1.address);
  await (await rs.connect(deployer).claim(1)).wait();
  assertEq(
    (await ethers.provider.getBalance(agentW1.address)) - w1Before,
    ETH('0.04'), 'agent1 claimed 0.04'
  );

  // ── 9. Audit trail + prompt registry ───────────────────────────────────────
  step('AuditTrail record + PromptRegistry commit');
  await (await at.recordAudit(
    Number(p1), ethers.id('p1-input'), ethers.id('p1-output'), ethers.id('p1-nodes'), 3
  )).wait();
  assertEq(await at.auditCount(Number(p1)), 1n, 'audit recorded');
  await (await pr.registerPrompt(ethers.id('audit-v1'), ethers.id('QmPromptHash'), 'A2A 3D audit prompt')).wait();
  await (await pr.activatePrompt(ethers.id('audit-v1'))).wait();
  console.log('  ✓ prompt registered + activated');

  // ── Final state summary ─────────────────────────────────────────────────────
  step('Final chain state');
  console.log(`  vault ETH        : ${fmt(await fundVault.vaultBalance())}`);
  console.log(`  accrualFactor    : ${fmt(await fundToken.accrualFactor())}`);
  console.log(`  LP balance       : ${fmt(await fundToken.balanceOf(lp.address))} (${fmt(await fundToken.getShares(lp.address))} shares)`);
  console.log(`  projects         : 5 (Exited, Rejected, Vetoed, WriteOff, PendingExecution)`);

  const state = {
    chainId: net.chainId.toString(),
    rpcUrl: 'http://127.0.0.1:8545',
    contracts: {
      fundToken: await fundToken.getAddress(),
      fundVault: await fundVault.getAddress(),
      investmentManager: await im.getAddress(),
      omniOracle: await mockOracle.getAddress(),
      nfa: await nfa.getAddress(),
      revenueShare: await rs.getAddress(),
      auditTrail: await at.getAddress(),
      promptRegistry: await pr.getAddress(),
      deadManSwitch: await dms.getAddress(),
    },
    wallets: {
      deployer: deployer.address,
      lp: lp.address,
      applicant: applicant.address,
    },
    setupAt: new Date().toISOString(),
  };
  const statePath = path.join(process.cwd(), '.e2e-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`\n  State written → ${statePath}`);

  console.log('\n' + '='.repeat(56));
  console.log('  ✅ CONTRACT E2E PASSED — chain seeded for frontend');
  console.log('='.repeat(56));
}

main().catch(err => {
  console.error('\n❌ E2E FAILED:', err.message || err);
  process.exit(1);
});
