import { ethers, network } from 'hardhat';

const LOCAL_RPC = 'http://127.0.0.1:8545';

async function main() {
  // Force connection to the actual running Hardhat node
  await network.provider.request({ method: 'hardhat_reset', params: [] });

  const [deployer, user1, user2] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Connected to network:', (await ethers.provider.getNetwork()).chainId.toString());

  // ── 1. Deploy Mock WETH ──────────────────────────────────────────────────
  console.log('\n--- Deploying Mock WETH ---');
  const MockWETH = await ethers.getContractFactory('MockWETH');
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  console.log('MockWETH:', await weth.getAddress());

  // ── 2. Deploy Mock AAVE Pool ─────────────────────────────────────────────
  console.log('\n--- Deploying Mock AAVE Pool ---');
  const MockAavePool = await ethers.getContractFactory('MockAavePool');
  const aavePool = await MockAavePool.deploy();
  await aavePool.waitForDeployment();
  console.log('MockAavePool:', await aavePool.getAddress());

  // ── 3. Deploy Mock aWETH ─────────────────────────────────────────────────
  console.log('\n--- Deploying Mock aWETH ---');
  const MockAToken = await ethers.getContractFactory('MockAToken');
  const aWeth = await MockAToken.deploy(await aavePool.getAddress(), await weth.getAddress());
  await aWeth.waitForDeployment();
  console.log('MockaWETH:', await aWeth.getAddress());

  // ── 4. Configure AAVE Pool with aToken ──────────────────────────────────
  console.log('\n--- Configuring AAVE Pool ---');
  await aavePool.setAToken(await weth.getAddress(), await aWeth.getAddress());
  console.log('aToken configured for WETH');

  // ── 5. Deploy FundToken ──────────────────────────────────────────────────
  console.log('\n--- Deploying FundToken ---');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();
  console.log('FundToken:', await fundToken.getAddress());

  // ── 6. Deploy FundVault ──────────────────────────────────────────────────
  console.log('\n--- Deploying FundVault ---');
  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(
    await weth.getAddress(),
    await aavePool.getAddress(),
    await aWeth.getAddress(),
    await fundToken.getAddress()
  );
  await fundVault.waitForDeployment();
  console.log('FundVault:', await fundVault.getAddress());

  // ── 7. Deploy InvestmentManager ────────────────────────────────────────
  console.log('\n--- Deploying InvestmentManager ---');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const investmentManager = await InvestmentManager.deploy(
    await fundVault.getAddress(),
    await weth.getAddress()
  );
  await investmentManager.waitForDeployment();
  console.log('InvestmentManager:', await investmentManager.getAddress());

  // ── 8. Deploy PromptRegistry ─────────────────────────────────────────────
  console.log('\n--- Deploying PromptRegistry ---');
  const PromptRegistry = await ethers.getContractFactory('PromptRegistry');
  const promptRegistry = await PromptRegistry.deploy(deployer.address);
  await promptRegistry.waitForDeployment();
  console.log('PromptRegistry:', await promptRegistry.getAddress());

  // ── 9. Deploy AuditTrail ─────────────────────────────────────────────────
  console.log('\n--- Deploying AuditTrail ---');
  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await auditTrail.waitForDeployment();
  console.log('AuditTrail:', await auditTrail.getAddress());

  // ── 10. Deploy OmniOracle (mock, no Chainlink router) ────────────────────
  console.log('\n--- Deploying OmniOracle ---');
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const omniOracle = await OmniOracle.deploy(
    ethers.ZeroAddress,
    1234,
    ethers.id('omnivault-don')
  );
  await omniOracle.waitForDeployment();
  console.log('OmniOracle:', await omniOracle.getAddress());

  // ── 11. Deploy MPCGateway ────────────────────────────────────────────────
  console.log('\n--- Deploying MPCGateway ---');
  const MPCGateway = await ethers.getContractFactory('MPCGateway');
  const mpcGateway = await MPCGateway.deploy(deployer.address);
  await mpcGateway.waitForDeployment();
  console.log('MPCGateway:', await mpcGateway.getAddress());

  // ── 12. Setup Roles ───────────────────────────────────────────────────────
  console.log('\n--- Setting up roles ---');

  const MINTER_ROLE = await fundToken.MINTER_ROLE();
  const BURNER_ROLE = await fundToken.BURNER_ROLE();
  await fundToken.grantRole(MINTER_ROLE, await fundVault.getAddress());
  await fundToken.grantRole(BURNER_ROLE, await fundVault.getAddress());
  console.log('FundToken MINTER/BURNER -> FundVault');

  const INVESTOR_ROLE = await fundVault.INVESTOR_ROLE();
  await fundVault.grantRole(INVESTOR_ROLE, await investmentManager.getAddress());
  console.log('FundVault INVESTOR_ROLE -> InvestmentManager');

  const AI_ORACLE_ROLE = await investmentManager.AI_ORACLE_ROLE();
  const RISK_AGENT_ROLE = await investmentManager.RISK_AGENT_ROLE();
  await investmentManager.grantRole(AI_ORACLE_ROLE, await omniOracle.getAddress());
  await investmentManager.grantRole(RISK_AGENT_ROLE, deployer.address);
  console.log('InvestmentManager AI_ORACLE_ROLE -> OmniOracle');
  console.log('InvestmentManager RISK_AGENT_ROLE -> Deployer');

  const AUDIT_EXECUTOR_ROLE = await omniOracle.AUDIT_EXECUTOR_ROLE();
  await omniOracle.grantRole(AUDIT_EXECUTOR_ROLE, deployer.address);
  console.log('OmniOracle AUDIT_EXECUTOR_ROLE -> Deployer');

  // ── 13. Fund accounts with ETH ──────────────────────────────────────────
  console.log('\n--- Funding test accounts ---');
  const fundAmount = ethers.parseEther('10');
  await user1.sendTransaction({ to: user1.address, value: fundAmount });
  await user2.sendTransaction({ to: user2.address, value: fundAmount });
  console.log('user1 and user2 funded with 10 ETH each');

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('=== LOCAL DEPLOYMENT COMPLETE ===');
  console.log('========================================');
  console.log('\nContract Addresses:');
  console.log('  WETH:              ', await weth.getAddress());
  console.log('  MockAavePool:     ', await aavePool.getAddress());
  console.log('  MockaWETH:        ', await aWeth.getAddress());
  console.log('  FundToken:        ', await fundToken.getAddress());
  console.log('  FundVault:         ', await fundVault.getAddress());
  console.log('  InvestmentManager: ', await investmentManager.getAddress());
  console.log('  PromptRegistry:    ', await promptRegistry.getAddress());
  console.log('  AuditTrail:        ', await auditTrail.getAddress());
  console.log('  OmniOracle:        ', await omniOracle.getAddress());
  console.log('  MPCGateway:        ', await mpcGateway.getAddress());
  console.log('\n.env.local values:');
  console.log(`NEXT_PUBLIC_FUND_VAULT_ADDRESS=${await fundVault.getAddress()}`);
  console.log(`NEXT_PUBLIC_FUND_TOKEN_ADDRESS=${await fundToken.getAddress()}`);
  console.log(`NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${await investmentManager.getAddress()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
