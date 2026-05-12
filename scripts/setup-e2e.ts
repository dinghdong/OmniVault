/**
 * E2E Setup Script — deploys all contracts and seeds initial state
 * Usage: npx hardhat run scripts/setup-e2e.ts --network localhost
 *
 * Hardhat accounts used:
 *   [0] deployer  — admin, owns all roles
 *   [1] lp        — deposits 5 ETH as LP
 *   [2] oracle    — holds AI_ORACLE_ROLE (simulates AI service wallet)
 *   [3] applicant — submits the project
 *
 * Writes .e2e-state.json to the repo root for test-e2e.js to consume.
 */
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ETH = ethers.parseEther;
const fmt = (n: bigint) => ethers.formatEther(n);
const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`);

async function main() {
  const [deployer, lp, oracle, applicant] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log('='.repeat(52));
  console.log('  OmniVault E2E Setup');
  console.log('='.repeat(52));
  console.log(`Chain ID  : ${network.chainId}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`LP        : ${lp.address}`);
  console.log(`Oracle    : ${oracle.address}`);
  console.log(`Applicant : ${applicant.address}`);

  // ── 1. Deploy Mock WETH ────────────────────────────────────────────────────
  step(1, 'Deploying MockWETH');
  const MockWETH = await ethers.getContractFactory('MockWETH');
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  console.log('  MockWETH:', await weth.getAddress());

  // ── 2. Deploy Mock AAVE Pool + aToken ─────────────────────────────────────
  step(2, 'Deploying MockAavePool + MockAToken');
  const MockAavePool = await ethers.getContractFactory('MockAavePool');
  const aavePool = await MockAavePool.deploy();
  await aavePool.waitForDeployment();

  const MockAToken = await ethers.getContractFactory('MockAToken');
  const aWeth = await MockAToken.deploy(
    await aavePool.getAddress(),
    await weth.getAddress()
  );
  await aWeth.waitForDeployment();
  await aavePool.setAToken(await weth.getAddress(), await aWeth.getAddress());
  console.log('  MockAavePool:', await aavePool.getAddress());
  console.log('  MockAToken  :', await aWeth.getAddress());

  // ── 3. Deploy FundToken ───────────────────────────────────────────────────
  step(3, 'Deploying FundToken');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();
  console.log('  FundToken:', await fundToken.getAddress());

  // ── 4. Deploy FundVault ───────────────────────────────────────────────────
  step(4, 'Deploying FundVault');
  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(
    await weth.getAddress(),
    await aavePool.getAddress(),
    await aWeth.getAddress(),
    await fundToken.getAddress()
  );
  await fundVault.waitForDeployment();
  console.log('  FundVault:', await fundVault.getAddress());

  // ── 5. Deploy InvestmentManager ───────────────────────────────────────────
  step(5, 'Deploying InvestmentManager');
  const IM = await ethers.getContractFactory('InvestmentManager');
  const im = await IM.deploy(
    await fundVault.getAddress(),
    await weth.getAddress()
  );
  await im.waitForDeployment();
  console.log('  InvestmentManager:', await im.getAddress());

  // ── 6. Grant roles ────────────────────────────────────────────────────────
  step(6, 'Granting roles');

  // FundToken: MINTER + BURNER → FundVault
  await fundToken.grantRole(await fundToken.MINTER_ROLE(), await fundVault.getAddress());
  await fundToken.grantRole(await fundToken.BURNER_ROLE(), await fundVault.getAddress());
  console.log('  FundToken MINTER/BURNER → FundVault ✓');

  // FundVault: INVESTOR_ROLE → InvestmentManager
  await fundVault.grantRole(await fundVault.INVESTOR_ROLE(), await im.getAddress());
  console.log('  FundVault INVESTOR_ROLE → InvestmentManager ✓');

  // InvestmentManager: AI_ORACLE_ROLE → oracle wallet (AI service)
  await im.grantRole(await im.AI_ORACLE_ROLE(), oracle.address);
  console.log(`  InvestmentManager AI_ORACLE_ROLE → ${oracle.address} ✓`);

  // InvestmentManager: RISK_AGENT_ROLE → deployer (for circuit break tests)
  await im.grantRole(await im.RISK_AGENT_ROLE(), deployer.address);
  console.log('  InvestmentManager RISK_AGENT_ROLE → deployer ✓');

  // ── 7. LP deposits 5 ETH ─────────────────────────────────────────────────
  step(7, 'LP deposits 5 ETH into FundVault');
  await fundVault.connect(lp).deposit({ value: ETH('5') });
  const lpShares = await fundToken.balanceOf(lp.address);
  console.log(`  LP FundToken balance: ${fmt(lpShares)} OVFT`);
  console.log(`  Vault aWETH balance : ${fmt(await aWeth.balanceOf(await fundVault.getAddress()))} aWETH`);

  // ── 8. Fund vault with raw ETH (WETH.withdraw needs it) ──────────────────
  step(8, 'Fund vault and IM with raw ETH for gas');
  await ethers.provider.send('hardhat_setBalance', [
    await fundVault.getAddress(),
    '0x' + ETH('1').toString(16),
  ]);
  await ethers.provider.send('hardhat_setBalance', [
    await im.getAddress(),
    '0x' + ETH('1').toString(16),
  ]);
  console.log('  Vault ETH balance: 1 ETH ✓');
  console.log('  IM ETH balance   : 1 ETH ✓');

  // ── Write state file ───────────────────────────────────────────────────────
  const state = {
    chainId: network.chainId.toString(),
    contracts: {
      weth: await weth.getAddress(),
      aavePool: await aavePool.getAddress(),
      aWeth: await aWeth.getAddress(),
      fundToken: await fundToken.getAddress(),
      fundVault: await fundVault.getAddress(),
      investmentManager: await im.getAddress(),
    },
    wallets: {
      deployer: deployer.address,
      lp: lp.address,
      oracle: oracle.address,
      applicant: applicant.address,
    },
    // Hardhat well-known private keys (safe for local testing only)
    privateKeys: {
      oracle: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      applicant: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    },
    rpcUrl: 'http://127.0.0.1:8545',
    setupAt: new Date().toISOString(),
  };

  const statePath = path.join(process.cwd(), '.e2e-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`\n  State written → ${statePath}`);

  console.log('\n' + '='.repeat(52));
  console.log('  Setup complete. Now run:');
  console.log('  cd ai-service && node scripts/test-e2e.js');
  console.log('  (add --mock-ai to skip real LLM calls)');
  console.log('='.repeat(52) + '\n');
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
