import { ethers } from 'hardhat';

const ORACLE_ADDRESS = '0x4E5dcD649ff2d425A56B4b314cb800a08418C4d0';
const SUB_ID = 6554;

const ABI = ['function setSubscriptionId(uint64 newSubId) external'];

async function main() {
  const [signer] = await ethers.getSigners();
  const oracle = new ethers.Contract(ORACLE_ADDRESS, ABI, signer);
  console.log('Setting subscription ID to', SUB_ID, '...');
  const tx = await oracle.setSubscriptionId(SUB_ID);
  await tx.wait();
  console.log('✓ Done. tx:', tx.hash);
}

main().catch(console.error);
