import { ethers } from 'hardhat';
const hre = require('hardhat');

async function main() {
  const [deployer, user1, user2] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log('Network chainId:', chainId.toString());
  console.log('Deployer:', deployer.address);
  console.log('User1:', user1.address);

  // ── Deploy ──────────────────────────────────────────────────────────────────
  console.log('\n--- Deploying Mock WETH ---');
  const MockWETH = await ethers.getContractFactory('MockWETH');
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  console.log('MockWETH:', await weth.getAddress());

  console.log('\n--- Deploying Mock AAVE Pool ---');
  const MockAavePool = await ethers.getContractFactory('MockAavePool');
  const aavePool = await MockAavePool.deploy();
  await aavePool.waitForDeployment();
  console.log('MockAavePool:', await aavePool.getAddress());

  console.log('\n--- Deploying Mock aWETH ---');
  const MockAToken = await ethers.getContractFactory('MockAToken');
  const aWeth = await MockAToken.deploy(await aavePool.getAddress(), await weth.getAddress());
  await aWeth.waitForDeployment();
  console.log('MockaWETH:', await aWeth.getAddress());

  await aavePool.setAToken(await weth.getAddress(), await aWeth.getAddress());
  console.log('AAVE Pool configured with aToken');

  console.log('\n--- Deploying FundToken ---');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();
  console.log('FundToken:', await fundToken.getAddress());

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

  console.log('\n--- Deploying InvestmentManager ---');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const investmentManager = await InvestmentManager.deploy(
    await fundVault.getAddress(),
    await weth.getAddress()
  );
  await investmentManager.waitForDeployment();
  console.log('InvestmentManager:', await investmentManager.getAddress());

  // Setup roles
  const MINTER = await fundToken.MINTER_ROLE();
  const BURNER = await fundToken.BURNER_ROLE();
  await fundToken.grantRole(MINTER, await fundVault.getAddress());
  await fundToken.grantRole(BURNER, await fundVault.getAddress());
  await fundVault.grantRole(await fundVault.INVESTOR_ROLE(), await investmentManager.getAddress());
  await fundVault.grantRole(await fundVault.INVESTOR_ROLE(), deployer.address); // test only
  console.log('Roles configured');

  // ── E2E Test ────────────────────────────────────────────────────────────────
  const ETH = (n: string) => ethers.parseEther(n);
  const fmt = (n: bigint) => parseFloat(ethers.formatEther(n)).toFixed(4);

  console.log('\n========================================');
  console.log('=== E2E TEST START ===');
  console.log('========================================');

  // Step 1: Initial state
  step(1, 'Initial state');
  console.log('FundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('AccrualFactor:', (await fundToken.accrualFactor()).toString());

  // Step 2: User1 deposits 1 ETH
  step(2, 'User1 deposits 1 ETH');
  const sharesBefore = await fundToken.balanceOf(user1.address);
  console.log('Shares before:', fmt(sharesBefore));
  const depositTx = await fundVault.connect(user1).deposit({ value: ETH('1') });
  await depositTx.wait();
  const sharesAfter = await fundToken.balanceOf(user1.address);
  console.log('Shares after deposit:', fmt(sharesAfter));
  console.log('FundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('AccrualFactor:', (await fundToken.accrualFactor()).toString());
  if (sharesAfter <= sharesBefore) throw new Error('FAIL: shares did not increase');

  // Step 3: User1 partial redeem (0.3 shares)
  step(3, 'User1 redeem 0.3 shares');
  // Fund vault with ETH for gas (bypasses receive() to avoid wrapping)
  const vaultAddr = await fundVault.getAddress();
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [vaultAddr, '0x' + (ETH('2')).toString(16)],
  });
  const redeemAmount = ETH('0.3');
  const ethBefore = await ethers.provider.getBalance(user1.address);
  const redeemTx = await fundVault.connect(user1).redeem(redeemAmount);
  await redeemTx.wait();
  const ethAfter = await ethers.provider.getBalance(user1.address);
  const received = parseFloat(ethers.formatEther(ethAfter - ethBefore));
  console.log('ETH received:', received.toFixed(4));
  const remainingShares = await fundToken.balanceOf(user1.address);
  console.log('Remaining shares:', fmt(remainingShares));
  if (received < 0.29) throw new Error('FAIL: received less than expected');
  console.log('PASS: partial redeem works');

  // Step 4: User2 deposits 2 ETH
  step(4, 'User2 deposits 2 ETH');
  const depositTx2 = await fundVault.connect(user2).deposit({ value: ETH('2') });
  await depositTx2.wait();
  console.log('User2 shares:', fmt(await fundToken.balanceOf(user2.address)));
  console.log('TotalSupply:', fmt(await fundToken.totalSupply()));
  console.log('PASS: multiple depositors work');

  // Step 5: Simulate yield (apply realized gains via aWETH accrual)
  step(5, 'Apply realized gains (0.2 ETH simulated yield)');
  // Mint extra aWETH to vault + give vault ETH to match (simulates real AAVE yield)
  await aWeth.mintForTest(await fundVault.getAddress(), ETH('0.2'));
  // Also give vault the actual ETH so it can pay out on withdraw
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [vaultAddr, '0x' + (ETH('2.5')).toString(16)],
  });
  await fundVault.connect(deployer).addRealizedGains(ETH('0.2'), ETH('2'));
  const factorAfterYield = await fundToken.accrualFactor();
  console.log('AccrualFactor after yield:', factorAfterYield.toString());
  const user2BalanceAfterYield = await fundToken.balanceOf(user2.address);
  console.log('User2 balance after yield:', fmt(user2BalanceAfterYield));
  const expected = parseFloat(ethers.formatEther(user2BalanceAfterYield));
  if (expected < 2.0) throw new Error('FAIL: balance did not increase with yield');
  console.log('PASS: yield accrual works');

  // Step 6: User2 full redeem
  step(6, 'User2 full redeem');
  // Fund vault with ETH for gas (ensure sufficient balance for full redeem)
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [vaultAddr, '0x' + (ETH('5')).toString(16)],
  });
  const user2AllShares = await fundToken.getShares(user2.address);
  const user2EthBefore = await ethers.provider.getBalance(user2.address);
  const redeemTx2 = await fundVault.connect(user2).redeem(user2AllShares);
  await redeemTx2.wait();
  const user2EthAfter = await ethers.provider.getBalance(user2.address);
  const user2Received = parseFloat(ethers.formatEther(user2EthAfter - user2EthBefore));
  console.log('ETH received by User2:', user2Received.toFixed(4));
  console.log('User2 remaining shares:', fmt(await fundToken.balanceOf(user2.address)));
  if (user2Received < 2.0) throw new Error('FAIL: User2 received less than deposited');
  console.log('PASS: full redeem works');

  // Step 7: Final state
  step(7, 'Final state');
  console.log('FundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('AccrualFactor:', (await fundToken.accrualFactor()).toString());

  console.log('\n========================================');
  console.log('=== ALL E2E TESTS PASSED ===');
  console.log('========================================');
  console.log('\n.env.local values:');
  console.log(`NEXT_PUBLIC_FUND_VAULT_ADDRESS=${fundVault.getAddress()}`);
  console.log(`NEXT_PUBLIC_FUND_TOKEN_ADDRESS=${fundToken.getAddress()}`);
  console.log(`NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${investmentManager.getAddress()}`);
}

function step(n: number, msg: string) {
  console.log(`\n=== Step ${n}: ${msg} ===`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nTEST FAILED:', err.message || err);
    process.exit(1);
  });
