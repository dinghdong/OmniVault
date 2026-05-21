import { ethers } from 'hardhat';

const LINK_TOKEN = '0x779877A7B0D9E8603169DdbD7836e478b4624789'; // Sepolia LINK
const ROUTER     = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const SUB_ID     = 6554n;
const FUND_JUELS = ethers.parseEther('3'); // 3 LINK

const LINK_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transferAndCall(address to, uint256 value, bytes calldata data) returns (bool)',
];
const ROUTER_ABI = [
  'function getSubscription(uint64) view returns (uint96 balance, uint96 blockedBalance, address owner, address proposedOwner, bytes32 flags, uint64 reqCount)',
];

async function main() {
  const [signer] = await ethers.getSigners();
  const link   = new ethers.Contract(LINK_TOKEN, LINK_ABI, signer);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);

  const walletBal = await link.balanceOf(signer.address);
  console.log('Wallet LINK:', ethers.formatEther(walletBal));

  // current sub balance
  try {
    const sub = await router.getSubscription(SUB_ID);
    console.log('Sub balance before:', ethers.formatEther(sub[0]), 'LINK');
  } catch(e) { console.log('(could not read sub balance)'); }

  if (walletBal < FUND_JUELS) {
    console.error(`Not enough LINK in wallet. Have ${ethers.formatEther(walletBal)}, need ${ethers.formatEther(FUND_JUELS)}`);
    process.exit(1);
  }

  // Fund: transferAndCall(router, amount, abi.encode(subId))
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['uint64'], [SUB_ID]);
  console.log(`\nFunding subscription #${SUB_ID} with ${ethers.formatEther(FUND_JUELS)} LINK...`);
  const tx = await link.transferAndCall(ROUTER, FUND_JUELS, encoded);
  await tx.wait();
  console.log('✓ Funded. tx:', tx.hash);

  try {
    const sub2 = await router.getSubscription(SUB_ID);
    console.log('Sub balance after:', ethers.formatEther(sub2[0]), 'LINK');
  } catch(e) { console.log('(check balance at functions.chain.link)'); }
}
main().catch(console.error);
