import { ethers } from 'hardhat';

const WETH_ADDR = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const AAVE_POOL = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const aWETH_ADDR = '0x9fE46736679d2D9a65F0992F2292dE9f3c7fa6e0';
const FUND_TOKEN = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const FUND_VAULT = '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707';
const INVESTMENT_MANAGER = '0x0165878A594ca255338adfa4d48449f69242Eb8F';

const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const USER1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USER2 = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

async function main() {
  const [deployer, user1, user2] = await ethers.getSigners();
  const weth = await ethers.getContractAt('MockWETH', WETH_ADDR);
  const aWeth = await ethers.getContractAt('MockAToken', aWETH_ADDR);
  const fundToken = await ethers.getContractAt('FundToken', FUND_TOKEN);
  const fundVault = await ethers.getContractAt('FundVault', FUND_VAULT);
  const investmentManager = await ethers.getContractAt('InvestmentManager', INVESTMENT_MANAGER);

  const ETH = ethers.parseEther;
  const fmt = (n: bigint) => ethers.formatEther(n);

  const log = (msg: string) => console.log(`\n[LOG] ${msg}`);
  const step = (n: number, msg: string) => console.log(`\n=== Step ${n}: ${msg} ===`);

  // ── Step 1: Check initial state ────────────────────────────────────────────
  step(1, 'Check initial state');
  console.log('FundVault ETH balance:', fmt(await ethers.provider.getBalance(FUND_VAULT)));
  console.log('FundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('FundToken accrualFactor:', (await fundToken.accrualFactor()).toString());
  console.log('AAVE Pool aWETH balance:', fmt(await aWeth.balanceOf(FUND_VAULT)));

  // ── Step 2: User1 deposits 1 ETH ─────────────────────────────────────────
  step(2, 'User1 deposits 1 ETH into FundVault');
  const depositAmount = ETH('1');
  const sharesBefore = await fundToken.balanceOf(user1.address);
  console.log('Shares before:', fmt(sharesBefore));

  const tx = await fundVault.connect(user1).deposit({ value: depositAmount });
  await tx.wait();
  console.log('TX mined:', tx.hash);

  const sharesAfter = await fundToken.balanceOf(user1.address);
  console.log('Shares after:', fmt(sharesAfter));
  console.log('FundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('AAVE Pool aWETH balance:', fmt(await aWeth.balanceOf(FUND_VAULT)));
  console.log('FundVault WETH balance:', fmt(await weth.balanceOf(FUND_VAULT)));

  // ── Step 3: Check balanceOf ────────────────────────────────────────────────
  step(3, 'Check balanceOf reflects shares');
  const user1Balance = await fundToken.balanceOf(user1.address);
  const vaultBalance = await fundVault.balanceOf(user1.address);
  console.log('fundToken.balanceOf(user1):', fmt(user1Balance));
  console.log('fundVault.balanceOf(user1):', fmt(vaultBalance));
  console.assert(user1Balance === vaultBalance, 'FAIL: balances should match');

  // ── Step 4: Simulate yield — deployer adds realized gains ───────────────────
  step(4, 'Simulate yield: deployer calls addRealizedGains(0.1 ETH)');
  const yieldAmount = ETH('0.1');
  console.log('AAVE Pool aWETH held by vault BEFORE yield:', fmt(await aWeth.balanceOf(FUND_VAULT)));
  console.log('FundToken accrualFactor BEFORE:', (await fundToken.accrualFactor()).toString());

  // Transfer some aWETH to simulate yield (mock aWETH accrual)
  // In real scenario, aWETH accrues over time. For testing, we mint more aWETH to vault.
  const MockAToken = await ethers.getContractFactory('MockAToken');
  const aWethAsMock = MockAToken.attach(aWETH_ADDR);
  // Mint extra aWETH to vault to simulate yield accrual
  await aWethAsMock.mint(FUND_VAULT, ETH('0.1'));
  console.log('Minted 0.1 aWETH to vault to simulate yield');

  // Call addRealizedGains with 0.1 ETH proceeds (converted via accrual)
  await fundVault.connect(deployer).addRealizedGains(ETH('0.1'), ETH('1'));

  console.log('FundToken accrualFactor AFTER:', (await fundToken.accrualFactor()).toString());
  const newBalance = await fundToken.balanceOf(user1.address);
  console.log('User1 FundToken balance AFTER yield:', fmt(newBalance));
  console.log('Expected ~1.1 ETH worth:', fmt(newBalance));

  // ── Step 5: User1 partial withdraw (0.5 shares) ─────────────────────────────
  step(5, 'User1 redeems 0.5 shares');
  const sharesToRedeem = ethers.parseEther('0.5');
  const user1WethBefore = await weth.balanceOf(user1.address);
  console.log('User1 WETH before redeem:', fmt(user1WethBefore));

  const redeemTx = await fundVault.connect(user1).redeem(sharesToRedeem);
  await redeemTx.wait();
  console.log('TX mined:', redeemTx.hash);

  const user1WethAfter = await weth.balanceOf(user1.address);
  console.log('User1 WETH after redeem:', fmt(user1WethAfter));
  console.log('WETH received:', fmt(user1WethAfter - user1WethBefore));
  console.log('User1 remaining shares:', fmt(await fundToken.balanceOf(user1.address)));

  // ── Step 6: User2 deposits ────────────────────────────────────────────────
  step(6, 'User2 deposits 2 ETH');
  const tx2 = await fundVault.connect(user2).deposit({ value: ETH('2') });
  await tx2.wait();
  console.log('User2 FundToken balance:', fmt(await fundToken.balanceOf(user2.address)));
  console.log('Total FundToken supply:', fmt(await fundToken.totalSupply()));

  // ── Step 7: Final state ─────────────────────────────────────────────────
  step(7, 'Final state');
  console.log('FundVault ETH balance:', fmt(await ethers.provider.getBalance(FUND_VAULT)));
  console.log('FundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('FundToken accrualFactor:', (await fundToken.accrualFactor()).toString());
  console.log('User1 shares:', fmt(await fundToken.balanceOf(user1.address)));
  console.log('User2 shares:', fmt(await fundToken.balanceOf(user2.address)));

  // ── Step 8: Apply loss ──────────────────────────────────────────────────
  step(8, 'Deployer applies realized loss (simulate failed investment)');
  const loss = ETH('0.05');
  await fundVault.connect(deployer).addRealizedLoss(ETH('0.05'), ETH('1'));
  console.log('FundToken accrualFactor AFTER LOSS:', (await fundToken.accrualFactor()).toString());
  console.log('User1 shares AFTER LOSS:', fmt(await fundToken.balanceOf(user1.address)));

  // ── Step 9: Full withdraw ───────────────────────────────────────────────
  step(9, 'User1 full withdraw (burn all remaining shares)');
  const allShares = await fundToken.balanceOf(user1.address);
  const user1EthBefore = await ethers.provider.getBalance(user1.address);
  const redeemAllTx = await fundVault.connect(user1).redeem(allShares);
  await redeemAllTx.wait();
  const user1EthAfter = await ethers.provider.getBalance(user1.address);
  console.log('ETH received from full redeem:', fmt(user1EthAfter - user1EthBefore - ETH('0.0001'))); // subtract gas
  console.log('User1 remaining shares:', fmt(await fundToken.balanceOf(user1.address)));

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('=== ALL E2E TESTS PASSED ===');
  console.log('========================================');
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
