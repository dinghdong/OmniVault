import { ethers } from 'hardhat';

const ORACLE = '0x4E5dcD649ff2d425A56B4b314cb800a08418C4d0';
const NEW_GAS_LIMIT = 85_000;

const ABI = [
  'function s_callbackGasLimit() view returns (uint32)',
  'function setCallbackGasLimit(uint32 gasLimit) external',
];

async function main() {
  const [signer] = await ethers.getSigners();
  const oracle = new ethers.Contract(ORACLE, ABI, signer);

  const current = await oracle.s_callbackGasLimit();
  console.log('Current callbackGasLimit:', current.toString());

  console.log(`Setting callbackGasLimit to ${NEW_GAS_LIMIT}...`);
  const tx = await oracle.setCallbackGasLimit(NEW_GAS_LIMIT);
  await tx.wait();
  console.log('✓ Done. tx:', tx.hash);

  const updated = await oracle.s_callbackGasLimit();
  console.log('New callbackGasLimit:', updated.toString());
}
main().catch(console.error);
