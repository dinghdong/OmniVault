import { ethers } from 'hardhat';

async function main() {
  const [deployer, user1] = await ethers.getSigners();

  const weth = await ethers.getContractAt('MockWETH', '0x5FbDB2315678afecb367f032d93F642f64180aa3');
  const fundToken = await ethers.getContractAt('FundToken', '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9');
  const fundVault = await ethers.getContractAt('FundVault', '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707');
  const aWeth = await ethers.getContractAt('MockAToken', '0x9fE46736679d2D9a65F0992F2292dE9f3c7fa6e0');
  const aavePool = await ethers.getContractAt('MockAavePool', '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');

  const fmt = (n: bigint) => parseFloat(ethers.formatEther(n)).toFixed(4);

  console.log('=== Before deposit ===');
  console.log('user1 ETH:', fmt(await ethers.provider.getBalance(user1.address)));
  console.log('vault ETH:', fmt(await ethers.provider.getBalance(fundVault.getAddress())));
  console.log('vault WETH balance:', fmt(await weth.balanceOf(fundVault.getAddress())));
  console.log('vault aWETH balance:', fmt(await aWeth.balanceOf(fundVault.getAddress())));
  console.log('aavePool WETH balance:', fmt(await weth.balanceOf(aavePool.getAddress())));
  console.log('fundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('user1 shares:', fmt(await fundToken.balanceOf(user1.address)));

  console.log('\n=== Depositing 1 ETH ===');
  const tx = await fundVault.connect(user1).deposit({ value: ethers.parseEther('1') });
  const rcpt = await tx.wait();
  console.log('TX gasUsed:', rcpt.gasUsed.toString());

  console.log('\n=== After deposit ===');
  console.log('user1 ETH:', fmt(await ethers.provider.getBalance(user1.address)));
  console.log('vault ETH:', fmt(await ethers.provider.getBalance(fundVault.getAddress())));
  console.log('vault WETH:', fmt(await weth.balanceOf(fundVault.getAddress())));
  console.log('vault aWETH:', fmt(await aWeth.balanceOf(fundVault.getAddress())));
  console.log('aavePool WETH:', fmt(await weth.balanceOf(aavePool.getAddress())));
  console.log('fundToken totalSupply:', fmt(await fundToken.totalSupply()));
  console.log('user1 shares:', fmt(await fundToken.balanceOf(user1.address)));

  console.log('\n=== Redeeming 0.3 shares ===');
  const shares = ethers.parseEther('0.3');
  const sharesInVaultBefore = await fundToken.balanceOf(user1.address);
  console.log('Attempting to redeem:', fmt(shares), 'shares');
  console.log('Vault ETH before redeem:', fmt(await ethers.provider.getBalance(fundVault.getAddress())));
  console.log('Vault WETH before redeem:', fmt(await weth.balanceOf(fundVault.getAddress())));

  try {
    const redeemTx = await fundVault.connect(user1).redeem(shares);
    const rcpt2 = await redeemTx.wait();
    console.log('TX gasUsed:', rcpt2.gasUsed.toString());
    console.log('\n=== After redeem ===');
    console.log('user1 ETH:', fmt(await ethers.provider.getBalance(user1.address)));
    console.log('vault ETH:', fmt(await ethers.provider.getBalance(fundVault.getAddress())));
    console.log('vault WETH:', fmt(await weth.balanceOf(fundVault.getAddress())));
    console.log('vault aWETH:', fmt(await aWeth.balanceOf(fundVault.getAddress())));
    console.log('user1 shares:', fmt(await fundToken.balanceOf(user1.address)));
  } catch (err: any) {
    console.log('REDEEM FAILED:', err.message || err);
  }
}

main().catch(console.error);
