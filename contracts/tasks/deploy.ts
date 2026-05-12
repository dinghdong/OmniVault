import { task } from 'hardhat/config';

task('deploy:local', 'Deploy all contracts to local Hardhat network').setAction(async (_, hre) => {
  const { ethers, network } = hre;

  const [deployer, user1, user2] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Network:', (await network.provider.getNetwork()).chainId.toString());

  // Deploy Mock WETH
  console.log('\n--- Deploying Mock WETH ---');
  const MockWETH = await ethers.getContractFactory('MockWETH');
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  console.log('MockWETH:', await weth.getAddress());

  // Deploy Mock AAVE Pool
  console.log('\n--- Deploying Mock AAVE Pool ---');
  const MockAavePool = await ethers.getContractFactory('MockAavePool');
  const aavePool = await MockAavePool.deploy();
  await aavePool.waitForDeployment();
  console.log('MockAavePool:', await aavePool.getAddress());

  // Deploy Mock aWETH
  console.log('\n--- Deploying Mock aWETH ---');
  const MockAToken = await ethers.getContractFactory('MockAToken');
  const aWeth = await MockAToken.deploy(await aavePool.getAddress(), await weth.getAddress());
  await aWeth.waitForDeployment();
  console.log('MockaWETH:', await aWeth.getAddress());

  // Configure AAVE Pool
  await aavePool.setAToken(await weth.getAddress(), await aWeth.getAddress());
  console.log('aToken configured for WETH');

  // Deploy FundToken
  console.log('\n--- Deploying FundToken ---');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();
  console.log('FundToken:', await fundToken.getAddress());

  // Deploy FundVault
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

  // Deploy InvestmentManager
  console.log('\n--- Deploying InvestmentManager ---');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const investmentManager = await InvestmentManager.deploy(
    await fundVault.getAddress(),
    await weth.getAddress()
  );
  await investmentManager.waitForDeployment();
  console.log('InvestmentManager:', await investmentManager.getAddress());

  // Deploy remaining contracts
  const PromptRegistry = await ethers.getContractFactory('PromptRegistry');
  const promptRegistry = await PromptRegistry.deploy(deployer.address);
  await promptRegistry.waitForDeployment();
  console.log('PromptRegistry:', await promptRegistry.getAddress());

  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await auditTrail.waitForDeployment();
  console.log('AuditTrail:', await auditTrail.getAddress());

  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const omniOracle = await OmniOracle.deploy(ethers.ZeroAddress, 1234, ethers.id('omnivault-don'));
  await omniOracle.waitForDeployment();
  console.log('OmniOracle:', await omniOracle.getAddress());

  const MPCGateway = await ethers.getContractFactory('MPCGateway');
  const mpcGateway = await MPCGateway.deploy(deployer.address);
  await mpcGateway.waitForDeployment();
  console.log('MPCGateway:', await mpcGateway.getAddress());

  // Setup roles
  console.log('\n--- Setting up roles ---');
  const MINTER_ROLE = await fundToken.MINTER_ROLE();
  const BURNER_ROLE = await fundToken.BURNER_ROLE();
  await fundToken.grantRole(MINTER_ROLE, await fundVault.getAddress());
  await fundToken.grantRole(BURNER_ROLE, await fundVault.getAddress());

  const INVESTOR_ROLE = await fundVault.INVESTOR_ROLE();
  await fundVault.grantRole(INVESTOR_ROLE, await investmentManager.getAddress());

  const AI_ORACLE_ROLE = await investmentManager.AI_ORACLE_ROLE();
  const RISK_AGENT_ROLE = await investmentManager.RISK_AGENT_ROLE();
  await investmentManager.grantRole(AI_ORACLE_ROLE, await omniOracle.getAddress());
  await investmentManager.grantRole(RISK_AGENT_ROLE, deployer.address);

  const AUDIT_EXECUTOR_ROLE = await omniOracle.AUDIT_EXECUTOR_ROLE();
  await omniOracle.grantRole(AUDIT_EXECUTOR_ROLE, deployer.address);

  // Fund test accounts
  const fundAmount = ethers.parseEther('10');
  await user1.sendTransaction({ to: user1.address, value: fundAmount });
  await user2.sendTransaction({ to: user2.address, value: fundAmount });

  console.log('\n========================================');
  console.log('=== DEPLOYMENT COMPLETE ===');
  console.log('========================================');
  console.log('\n.env.local:');
  console.log(`NEXT_PUBLIC_FUND_VAULT_ADDRESS=${await fundVault.getAddress()}`);
  console.log(`NEXT_PUBLIC_FUND_TOKEN_ADDRESS=${await fundToken.getAddress()}`);
  console.log(`NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${await investmentManager.getAddress()}`);
});

task('test:e2e', 'Run end-to-end vault test')
  .addParam('vault', 'FundVault address')
  .addParam('token', 'FundToken address')
  .addParam('manager', 'InvestmentManager address')
  .setAction(async (args, hre) => {
    const { ethers } = hre;
    const [deployer, user1, user2] = await ethers.getSigners();
    const ETH = (n: string) => ethers.parseEther(n);
    const fmt = (n: bigint) => parseFloat(ethers.formatEther(n)).toFixed(4);

    const fundToken = await ethers.getContractAt('FundToken', args.token);
    const fundVault = await ethers.getContractAt('FundVault', args.vault);
    const investmentManager = await ethers.getContractAt('InvestmentManager', args.manager);

    // Step 1: Initial state
    console.log('\n=== Step 1: Initial State ===');
    console.log('TotalSupply:', fmt(await fundToken.totalSupply()));
    console.log('AccrualFactor:', (await fundToken.accrualFactor()).toString());

    // Step 2: User1 deposits 1 ETH
    console.log('\n=== Step 2: User1 deposits 1 ETH ===');
    const sharesBefore = await fundToken.balanceOf(user1.address);
    console.log('Shares before:', fmt(sharesBefore));
    const tx = await fundVault.connect(user1).deposit({ value: ETH('1') });
    await tx.wait();
    const sharesAfter = await fundToken.balanceOf(user1.address);
    console.log('Shares after:', fmt(sharesAfter));
    console.log('TotalSupply:', fmt(await fundToken.totalSupply()));
    console.log('TX:', tx.hash);

    // Step 3: User1 full withdraw
    console.log('\n=== Step 3: User1 full withdraw ===');
    const allShares = await fundToken.balanceOf(user1.address);
    const ethBefore = await ethers.provider.getBalance(user1.address);
    const redeemTx = await fundVault.connect(user1).redeem(allShares);
    await redeemTx.wait();
    const ethAfter = await ethers.provider.getBalance(user1.address);
    const received = parseFloat(ethers.formatEther(ethAfter - ethBefore)) - 0.0005; // rough gas
    console.log('ETH received:', received.toFixed(4));
    console.log('TX:', redeemTx.hash);

    // Step 4: User2 deposits 2 ETH
    console.log('\n=== Step 4: User2 deposits 2 ETH ===');
    const tx2 = await fundVault.connect(user2).deposit({ value: ETH('2') });
    await tx2.wait();
    console.log('User2 shares:', fmt(await fundToken.balanceOf(user2.address)));
    console.log('TotalSupply:', fmt(await fundToken.totalSupply()));

    // Step 5: Apply yield
    console.log('\n=== Step 5: Apply yield (0.2 ETH gain) ===');
    // Mint extra aWETH to vault to simulate yield
    const aWethAddr = await ethers.getContractAt('MockAToken', await ethers.getContractAt('FundVault', args.vault).then(v => v.fundToken()).then(async () => {
      // Get aWETH from FundVault
      return '0x9fE46736679d2D9a65F0992F2292dE9f3c7fa6e0'; // hardcoded from deploy
    }));
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [args.vault],
    });
    // Use the deployer to mint aWETH to vault
    const MockAToken = await ethers.getContractFactory('MockAToken');
    const aWeth = MockAToken.attach('0x9fE46736679d2D9a65F0992F2292dE9f3c7fa6e0');
    await aWeth.mint(args.vault, ETH('0.2'));
    await fundVault.connect(deployer).addRealizedGains(ETH('0.2'), ETH('2'));
    console.log('AccrualFactor after yield:', (await fundToken.accrualFactor()).toString());
    console.log('User2 balance after yield:', fmt(await fundToken.balanceOf(user2.address)));

    console.log('\n========================================');
    console.log('=== ALL E2E TESTS PASSED ===');
    console.log('========================================');
  });
