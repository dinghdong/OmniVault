import { ethers } from 'hardhat';

const COORD  = '0xb2De0D8313A5FD107AF5bd1Bd8fE4Ab1bF412141';
const ROUTER = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';

async function main() {
  const provider = ethers.provider;

  console.log('=== COORDINATOR typeAndVersion ===');
  try {
    const raw = await provider.call({ to: COORD, data: '0x181f5a77' });
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string'], raw);
    console.log(decoded[0]);
  } catch(e) { console.log('reverted'); }

  // Try all coord storage slots 0-20 to find config
  console.log('\n=== COORDINATOR storage (non-zero) ===');
  for (let slot = 0; slot <= 20; slot++) {
    const val = await provider.getStorage(COORD, slot);
    if (val !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      console.log(`coord[${slot}]: ${val}`);
    }
  }

  console.log('\n=== ROUTER typeAndVersion ===');
  try {
    const raw = await provider.call({ to: ROUTER, data: '0x181f5a77' });
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string'], raw);
    console.log(decoded[0]);
  } catch(e) { console.log('reverted'); }

  console.log('\n=== ROUTER storage (non-zero) ===');
  for (let slot = 0; slot <= 10; slot++) {
    const val = await provider.getStorage(ROUTER, slot);
    if (val !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      console.log(`router[${slot}]: ${val}`);
    }
  }
}
main().catch(console.error);
