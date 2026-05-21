/**
 * deploy-demo.ts
 * Redeploys InvestmentManager + AgentVoting with 3-min timeouts for demo.
 * Keeps FundVault, FundToken, AgentRegistry unchanged.
 *
 *   npx hardhat run scripts/deploy-demo.ts --network zeroGTestnet
 */
import { ethers } from 'hardhat';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const FUND_VAULT_ADDRESS     = '0x786897DDc85D592C116e870AC46f4c0e3c8f2F41';
const FUND_TOKEN_ADDRESS     = '0x77dde9441D7d03f30963dA9C0d17431017487AFe';
const AGENT_REGISTRY_ADDRESS = '0x906eaF095b37978580E6cb5CD00b331e0B66D1aF';
const WETH_ADDRESS           = '0x43f6cfdba33946632ae6811b2f48a20a75601fd5';
const OLD_IM_ADDRESS         = '0x842eE0f4D036b2E6e29eAd8Dd596F04e6F5E29C7';

// Demo thresholds (both use 20% = 2000 bps so agents approve realistic scores)
const DEMO_SCORE_THRESHOLD   = 2000;  // 20% — IM final score gate
const DEMO_AGENT_THRESHOLD   = 2000;  // 20% — AI service per-agent vote gate

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForDeploy(contract: any, label: string, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await contract.waitForDeployment();
      await sleep(2000);
      return;
    } catch {
      process.stdout.write(i === 0 ? `  Waiting for ${label}` : '.');
      await sleep(4000);
    }
  }
  await contract.waitForDeployment();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await deployer.provider.getNetwork();
  console.log('Deployer:', deployer.address);
  console.log('Network chainId:', network.chainId.toString());
  console.log('Balance:', ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'OG');
  console.log('\n⏱  Contracts compiled with: COMMUNITY_WINDOW=3min, EXECUTION_DELAY=3min');
  console.log(`🎯  SCORE_THRESHOLD=${DEMO_SCORE_THRESHOLD} bps (${DEMO_SCORE_THRESHOLD/100}%), AGENT_THRESHOLD=${DEMO_AGENT_THRESHOLD} bps`);

  // 1. Deploy new InvestmentManager
  console.log('\nDeploying InvestmentManager (3-min timelock, 20% score threshold)...');
  const IM = await ethers.getContractFactory('InvestmentManager');
  const im = await IM.deploy(FUND_VAULT_ADDRESS, WETH_ADDRESS, DEMO_SCORE_THRESHOLD);
  await waitForDeploy(im, 'InvestmentManager');
  const IM_ADDRESS = await im.getAddress();
  console.log('✓ InvestmentManager:', IM_ADDRESS);

  // 2. Deploy new AgentVoting
  console.log('\nDeploying AgentVoting (3-min community window)...');
  const AV = await ethers.getContractFactory('AgentVoting');
  const av = await AV.deploy(AGENT_REGISTRY_ADDRESS, IM_ADDRESS, FUND_TOKEN_ADDRESS);
  await waitForDeploy(av, 'AgentVoting');
  const AV_ADDRESS = await av.getAddress();
  console.log('✓ AgentVoting:', AV_ADDRESS);

  // 3. Setup roles
  console.log('\nSetting up roles...');
  const fundVault = await ethers.getContractAt('FundVault', FUND_VAULT_ADDRESS);
  const INVESTOR_ROLE = await fundVault.INVESTOR_ROLE();
  try {
    await (await fundVault.revokeRole(INVESTOR_ROLE, OLD_IM_ADDRESS)).wait();
    console.log('  Revoked INVESTOR_ROLE from old InvestmentManager');
  } catch {
    console.log('  (old IM had no INVESTOR_ROLE — skipping revoke)');
  }
  await (await fundVault.grantRole(INVESTOR_ROLE, IM_ADDRESS)).wait();
  console.log('  Granted INVESTOR_ROLE to new InvestmentManager');

  const AI_ORACLE_ROLE  = await im.AI_ORACLE_ROLE();
  const RISK_AGENT_ROLE = await im.RISK_AGENT_ROLE();
  await (await im.grantRole(AI_ORACLE_ROLE,  AV_ADDRESS)).wait();
  console.log('  Granted AI_ORACLE_ROLE to AgentVoting');
  await (await im.grantRole(RISK_AGENT_ROLE, deployer.address)).wait();
  console.log('  Granted RISK_AGENT_ROLE to deployer');

  // 4. Update env files
  console.log('\nUpdating env files...');
  const root = join(__dirname, '..');

  const aiEnvPath = join(root, 'ai-service/.env');
  let aiEnv = readFileSync(aiEnvPath, 'utf-8');
  aiEnv = aiEnv
    .replace(/^INVESTMENT_MANAGER_ADDRESS=.*/m, `INVESTMENT_MANAGER_ADDRESS=${IM_ADDRESS}`)
    .replace(/^AGENT_VOTING_ADDRESS=.*/m,       `AGENT_VOTING_ADDRESS=${AV_ADDRESS}`)
    .replace(/^AGENT_APPROVAL_THRESHOLD=.*/m,   `AGENT_APPROVAL_THRESHOLD=${DEMO_AGENT_THRESHOLD}`)
    .replace(/^COMMUNITY_WINDOW_MS=.*/m,        `COMMUNITY_WINDOW_MS=180000`)
    .replace(/^EXECUTION_DELAY_MS=.*/m,         `EXECUTION_DELAY_MS=180000`);
  writeFileSync(aiEnvPath, aiEnv);
  console.log('  ✓ ai-service/.env');

  const feEnvPath = join(root, 'frontend/.env.local');
  let feEnv = readFileSync(feEnvPath, 'utf-8');
  feEnv = feEnv
    .replace(/^NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=.*/m, `NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${IM_ADDRESS}`)
    .replace(/^NEXT_PUBLIC_AGENT_VOTING_ADDRESS=.*/m,       `NEXT_PUBLIC_AGENT_VOTING_ADDRESS=${AV_ADDRESS}`);
  writeFileSync(feEnvPath, feEnv);
  console.log('  ✓ frontend/.env.local');

  console.log('\n=== Done ===');
  console.log('InvestmentManager:', IM_ADDRESS);
  console.log('AgentVoting:      ', AV_ADDRESS);
  console.log('\nDemo timeline (~7 min):');
  console.log('  ~1 min  Agents vote → PendingExecution');
  console.log('  +3 min  Community window closes → triggerExecution auto-called');
  console.log('  +3 min  Timelock expires → executeInvestment → Active');
  console.log('\nRestart AI service and frontend after this script.');
}

main().catch(e => { console.error(e); process.exit(1); });
