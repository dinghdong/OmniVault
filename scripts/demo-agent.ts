/**
 * demo-agent.ts
 *
 * OmniVault Demo AI Agent — simulates the full A2A audit pipeline on Arbitrum Sepolia.
 *
 * Flow:
 *   1. AI agent submits a project (with agentDid / agentRepo / agentApiEndpoint)
 *   2. MockOmniOracleV2.setResult() — simulate Chainlink DON callback with 3D scores
 *   3. InvestmentManager.settleAudit() — finalize project status
 *   4. If approved: wait for timelock → executeInvestment()
 *   5. Report final state
 *
 * Usage:
 *   npx hardhat run scripts/demo-agent.ts --network arbitrumSepolia
 *
 * The script reads contract addresses from frontend/.env.local and uses the
 * deployer wallet (hardhat.config.cjs PRIVATE_KEY env var).
 */
import { ethers } from 'hardhat';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Load deployed addresses from .env.local ────────────────────────────────────
function loadEnv(): Record<string, string> {
  const envPath = join(__dirname, '../frontend/.env.local');
  const content = readFileSync(envPath, 'utf-8');
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Demo AI Agent identity ────────────────────────────────────────────────────
const AGENT_DID           = 'did:omni:agent:omnivault-demo-v1';
const AGENT_REPO          = 'https://github.com/dinghdong/OmniVault';
const AGENT_API_ENDPOINT  = 'https://api.omnivault-demo.ai/v1/audit';
const REQUESTED_ETH       = ethers.parseEther('0.01');   // 0.01 ETH for demo
const EXECUTION_DELAY_MS  = 3 * 60 * 1000 + 5_000;      // 3 min + 5s buffer

// ── Mock oracle scores (simulating 0G Compute output) ────────────────────────
const MOCK_RELIABILITY  = 88;
const MOCK_QUALITY      = 82;
const MOCK_MARKET_FIT   = 75;
// finalScore = 40%×88 + 30%×82 + 30%×75 = 35.2 + 24.6 + 22.5 = 82
const MOCK_FINAL_SCORE  = Math.min(100, Math.round(
  (MOCK_RELIABILITY * 4000 + MOCK_QUALITY * 3000 + MOCK_MARKET_FIT * 3000) / 10000
));
const MOCK_CONTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes('omnivault-demo-audit-log-v1'));

async function main() {
  const env = loadEnv();
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider!;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 421614) {
    throw new Error(`Wrong network (got ${chainId}). Run with --network arbitrumSepolia`);
  }

  const IM_ADDR     = env['NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS'];
  const ORACLE_ADDR = env['NEXT_PUBLIC_OMNI_ORACLE_ADDRESS'];
  const VAULT_ADDR  = env['NEXT_PUBLIC_FUND_VAULT_ADDRESS'];

  if (!IM_ADDR || !ORACLE_ADDR || !VAULT_ADDR) {
    throw new Error('Missing addresses in frontend/.env.local — run deploy-arb-sepolia.ts first');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('OmniVault Demo AI Agent — Arbitrum Sepolia');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Deployer/Agent:', deployer.address);
  console.log('ETH balance:', ethers.formatEther(await provider.getBalance(deployer.address)));
  console.log('InvestmentManager:', IM_ADDR);
  console.log('MockOmniOracleV2:', ORACLE_ADDR);
  console.log('FundVault:', VAULT_ADDR);
  console.log('');

  // ── Contract instances ────────────────────────────────────────────────────
  const IM_ABI = [
    'function submitProject(bytes32,address,string,uint256,string,string,string) returns (uint256)',
    'function settleAudit(uint256)',
    'function executeInvestment(uint256,uint256,bytes)',
    'function projects(uint256) view returns (address,bytes32,address,string,string,string,string,uint8,uint8,uint8,uint8,uint8,uint40,uint40,uint40,uint40,uint40,uint256,bytes32,uint256,uint256,uint256)',
    'function getAuditScores(uint256) view returns (uint8,uint8,uint8,uint8)',
    'function scoreThreshold() view returns (uint256)',
    'function EXECUTION_DELAY() view returns (uint256)',
    'event ProjectSubmitted(uint256 indexed,address indexed,bytes32,address,uint256,string)',
    'event AuditRequested(uint256 indexed,bytes32)',
  ];

  const ORACLE_ABI = [
    'function setResult(uint256,uint256,uint8,uint8,uint8,bytes32)',
    'function fulfilledScore(uint256) view returns (uint256)',
    'function fulfilledScores(uint256) view returns (uint8,uint8,uint8)',
  ];

  const VAULT_ABI = [
    'function vaultBalance() view returns (uint256)',
  ];

  const im     = new ethers.Contract(IM_ADDR,     IM_ABI,     deployer);
  const oracle = new ethers.Contract(ORACLE_ADDR, ORACLE_ABI, deployer);
  const vault  = new ethers.Contract(VAULT_ADDR,  VAULT_ABI,  deployer);

  // ── Step 1: Deposit ETH into vault (ensure enough balance) ───────────────
  console.log('Step 1: Checking vault balance…');
  const vaultBal = await vault.vaultBalance();
  console.log(`  Vault ETH: ${ethers.formatEther(vaultBal)} ETH`);

  const VAULT_F = await ethers.getContractFactory('FundVault');
  const fvContract = VAULT_F.attach(VAULT_ADDR) as any;

  if (vaultBal < REQUESTED_ETH) {
    console.log(`  Depositing ${ethers.formatEther(REQUESTED_ETH)} ETH into vault…`);
    const depositTx = await fvContract.deposit({ value: REQUESTED_ETH });
    await depositTx.wait();
    console.log(`  ✓ Deposited`);
  } else {
    console.log(`  ✓ Vault has sufficient ETH`);
  }

  // ── Step 2: AI Agent submits project ─────────────────────────────────────
  console.log('\nStep 2: AI Agent submits project…');
  console.log(`  agentDid: ${AGENT_DID}`);
  console.log(`  agentRepo: ${AGENT_REPO}`);
  console.log(`  requestedAmount: ${ethers.formatEther(REQUESTED_ETH)} ETH`);

  const commitHash = ethers.keccak256(ethers.toUtf8Bytes(`omnivault-demo-project-${Date.now()}`));
  const submitTx = await im.submitProject(
    commitHash,
    deployer.address,                 // contractAddr = agent's own address for demo
    'OmniVault Demo Project — AI-audited decentralized infrastructure',
    REQUESTED_ETH,
    AGENT_DID,
    AGENT_REPO,
    AGENT_API_ENDPOINT,
  );
  const submitReceipt = await submitTx.wait();

  // Parse ProjectSubmitted event to get projectId
  let projectId = 0n;
  const imInterface = new ethers.Interface([
    'event ProjectSubmitted(uint256 indexed projectId, address indexed applicant, bytes32 commitHash, address contractAddr, uint256 requestedAmount, string agentDid)',
  ]);
  for (const log of submitReceipt.logs) {
    try {
      const decoded = imInterface.parseLog(log);
      if (decoded && decoded.name === 'ProjectSubmitted') {
        projectId = BigInt(decoded.args.projectId);
        break;
      }
    } catch {}
  }

  if (!projectId) {
    throw new Error('Could not parse projectId from submitProject receipt');
  }

  console.log(`  ✓ Project #${projectId} submitted (tx: ${submitTx.hash.slice(0, 14)}…)`);

  // ── Step 3: Simulate Chainlink DON callback via MockOmniOracleV2 ──────────
  console.log('\nStep 3: Simulating Chainlink DON 3D audit result…');
  console.log(`  reliability=${MOCK_RELIABILITY}, quality=${MOCK_QUALITY}, marketFit=${MOCK_MARKET_FIT}`);
  console.log(`  finalScore=${MOCK_FINAL_SCORE} (threshold: ${await im.scoreThreshold()})`);

  const setResultTx = await oracle.setResult(
    projectId,
    BigInt(MOCK_FINAL_SCORE + 1),   // +1 sentinel (score=0 means unfulfilled)
    MOCK_RELIABILITY,
    MOCK_QUALITY,
    MOCK_MARKET_FIT,
    MOCK_CONTENT_HASH,
  );
  await setResultTx.wait();
  console.log(`  ✓ Oracle result stored`);

  // Verify oracle state
  const [r, q, m] = await oracle.fulfilledScores(projectId);
  console.log(`  Verified: reliability=${r}, quality=${q}, marketFit=${m}`);

  // ── Step 4: Settle audit (reads oracle result → updates IM status) ────────
  console.log('\nStep 4: Settling audit (two-transaction pattern)…');
  const settleTx = await im.settleAudit(projectId);
  await settleTx.wait();
  console.log(`  ✓ Audit settled`);

  // ── Step 5: Check project status ─────────────────────────────────────────
  const project    = await im.projects(projectId);
  const statusNum  = Number(project[7]);   // status field index
  const statusNames = ['None','Pending','Auditing','PendingExecution','Rejected','Active','CircuitBroken','Exited','WriteOff','Vetoed'];
  const statusName  = statusNames[statusNum] ?? 'Unknown';

  const [finalScore, reliability, quality, marketFit] = await im.getAuditScores(projectId);

  console.log('\n── Project State After Settlement ──────────────────────');
  console.log(`  Status:      ${statusName}`);
  console.log(`  Final Score: ${finalScore}/100`);
  console.log(`  Reliability: ${reliability}/100`);
  console.log(`  Quality:     ${quality}/100`);
  console.log(`  Market Fit:  ${marketFit}/100`);
  console.log(`  agentDid:    ${project[4]}`);

  if (statusNum === 3) {
    // PendingExecution — wait for timelock then execute
    const execDelay  = await im.EXECUTION_DELAY();
    const unlockTime = Number(project[15]) * 1000;   // executionUnlocksAt (index 15)
    const now        = Date.now();
    const waitMs     = Math.max(0, unlockTime - now);

    console.log(`\nStep 5: Waiting for execution timelock (${Number(execDelay)}s)…`);
    if (waitMs > 0) {
      console.log(`  Unlock at: ${new Date(unlockTime).toISOString()}`);
      console.log(`  Sleeping ${(waitMs / 1000).toFixed(0)}s…`);
      await sleep(waitMs + 2000);
    }

    console.log('  Executing investment…');
    const executeTx = await im.executeInvestment(projectId, REQUESTED_ETH, '0x');
    await executeTx.wait();
    console.log(`  ✓ Investment executed!`);

    const projectAfter = await im.projects(projectId);
    console.log(`  Final status: ${statusNames[Number(projectAfter[7])]}`);
  } else if (statusNum === 4) {
    console.log('\n  → Project REJECTED (score below threshold or audit failed).');
  } else {
    console.log(`\n  → Unexpected status: ${statusName}`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅  Demo AI Agent run complete!');
  console.log(`   Project #${projectId} on Arbitrum Sepolia`);
  console.log(`   Explorer: https://sepolia.arbiscan.io/address/${IM_ADDR}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
