import { ethers } from 'hardhat';

const COORD  = '0xb2De0D8313A5FD107AF5bd1Bd8fE4Ab1bF412141';

// Compute selectors for possible getter functions
function sel(sig: string) {
  return ethers.id(sig).slice(0, 10);
}

async function main() {
  const provider = ethers.provider;

  const fns = [
    'getMaxCallbackGasLimit()',
    'getGasOverheadBeforeCallback()',
    'getGasOverheadAfterCallback()',
    'getAdminFee()',
    'getConfig()',
    'typeAndVersion()',
    'i_config()',
    's_config()',
  ];

  for (const fn of fns) {
    const selector = sel(fn);
    try {
      const raw = await provider.call({ to: COORD, data: selector });
      console.log(`✓ ${fn} [${selector}]: ${raw}`);
    } catch {
      console.log(`✗ ${fn} [${selector}]: reverted`);
    }
  }

  // Also try decoding slot 8 as the config struct
  // FunctionsBillingConfig (packed, right-to-left):
  // slot 8 = 0x080000000073f22066000100b2d05e000000dea8000207880003f48000015f90
  const slot8 = '080000000073f22066000100b2d05e000000dea8000207880003f48000015f90';
  const buf = Buffer.from(slot8, 'hex');

  console.log('\n=== Slot 8 decoded (right→left, 4 bytes each) ===');
  const fields = ['field0(rightmost)', 'field1', 'field2', 'field3', 'field4', 'field5', 'field6', 'field7'];
  for (let i = 0; i < 8; i++) {
    const off = 28 - i * 4;
    const val = buf.readUInt32BE(off);
    console.log(`  ${fields[i]}: ${val} (0x${val.toString(16)})`);
  }
}
main().catch(console.error);
