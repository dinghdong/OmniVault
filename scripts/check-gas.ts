import { ethers } from 'hardhat';

const COORD  = '0xb2De0D8313A5FD107AF5bd1Bd8fE4Ab1bF412141';
const ORACLE = '0x4E5dcD649ff2d425A56B4b314cb800a08418C4d0';

// FunctionsCoordinator v1.3.1 getConfig() selector = 0x243a7134
// But let's try a known field: s_config is a struct, let's find maxCallbackGasLimit
// Try calling specific view functions
const COORD_ABI = [
  'function typeAndVersion() view returns (string)',
  // The config struct includes maxCallbackGasLimit as uint32
  // Let's try to read raw storage or use a specific getter
];

async function main() {
  const provider = ethers.provider;

  // Try several known selectors for getConfig on different coordinator versions
  const selectors: Record<string, string> = {
    'getConfig()':            '0x243a7134',
    'getAdminFee()':          '0x2f7527cc',
  };

  for (const [name, sel] of Object.entries(selectors)) {
    try {
      const raw = await provider.call({ to: COORD, data: sel });
      console.log(`${name}: ${raw.slice(0, 130)}`);
    } catch(e: any) { console.log(`${name}: reverted`); }
  }

  // Check OmniOracle current gas limit
  const oracleAbi = ['function s_callbackGasLimit() view returns (uint32)'];
  const oracle = new ethers.Contract(ORACLE, oracleAbi, provider);
  console.log('\nOmniOracle.s_callbackGasLimit:', (await oracle.s_callbackGasLimit()).toString());

  // The Coordinator v1.3 config struct typically has maxCallbackGasLimit
  // Let's decode the raw slot values
  // s_config is typically at storage slot 4 or 5 in coordinator
  for (let slot = 0; slot <= 8; slot++) {
    const val = await provider.getStorage(COORD, slot);
    if (val !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      console.log(`storage[${slot}]: ${val}`);
    }
  }
}
main().catch(console.error);
