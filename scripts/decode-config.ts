import { ethers } from 'hardhat';

const COORD  = '0xb2De0D8313A5FD107AF5bd1Bd8fE4Ab1bF412141';
const ROUTER = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const ORACLE = '0x4E5dcD649ff2d425A56B4b314cb800a08418C4d0';

async function main() {
  const provider = ethers.provider;

  // Verify current OmniOracle gas limit
  const oAbi = ['function s_callbackGasLimit() view returns (uint32)'];
  const oracle = new ethers.Contract(ORACLE, oAbi, provider);
  console.log('OmniOracle.s_callbackGasLimit:', (await oracle.s_callbackGasLimit()).toString());

  // Decode coordinator getConfig() — ABI: returns (FunctionsBillingConfig)
  // struct fields (v1.3.1): maxCallbackGasLimit, feedStalenessSeconds, gasOverheadBeforeCallback,
  // gasOverheadAfterCallback, requestTimeoutSeconds, donFee, maxSupportedRequestDataVersion,
  // fulfillmentGasPrice, fallbackNativePerUnitLink, operationFeeMultiplier
  const coordAbi = [
    'function getConfig() view returns (uint32 maxCallbackGasLimit, uint32 feedStalenessSeconds, uint32 gasOverheadBeforeCallback, uint32 gasOverheadAfterCallback, uint32 requestTimeoutSeconds, uint72 donFee, uint16 maxSupportedRequestDataVersion, uint256 fulfillmentGasPrice, uint256 fallbackNativePerUnitLink, uint8 operationFeeMultiplier)',
  ];
  try {
    const coord = new ethers.Contract(COORD, coordAbi, provider);
    const cfg = await coord.getConfig();
    console.log('\nCoordinator getConfig():');
    console.log('  maxCallbackGasLimit:', cfg[0].toString());
    console.log('  feedStalenessSeconds:', cfg[1].toString());
    console.log('  gasOverheadBeforeCallback:', cfg[2].toString());
    console.log('  gasOverheadAfterCallback:', cfg[3].toString());
    console.log('  requestTimeoutSeconds:', cfg[4].toString());
    console.log('  donFee (juels):', cfg[5].toString());
    console.log('  maxSupportedRequestDataVersion:', cfg[6].toString());
    console.log('  operationFeeMultiplier:', cfg[9].toString());
  } catch(e: any) {
    console.log('Coordinator getConfig() error:', e.message.slice(0, 200));

    // Fallback: try raw decode with just uints
    const raw = await provider.call({ to: COORD, data: '0xc3f909d4' });
    console.log('\nRaw getConfig() response (decoded as uint256[]):');
    const words = raw.slice(2).match(/.{64}/g) || [];
    words.forEach((w, i) => {
      const n = BigInt('0x' + w);
      if (n > 0n) console.log(`  [${i}] ${n} (0x${n.toString(16)})`);
    });
  }

  // Try router getConfig()
  console.log('\n=== Router getConfig() ===');
  try {
    const raw = await provider.call({ to: ROUTER, data: '0xc3f909d4' });
    const words = raw.slice(2).match(/.{64}/g) || [];
    words.forEach((w, i) => {
      const n = BigInt('0x' + w);
      if (n > 0n) console.log(`  [${i}] ${n} (0x${n.toString(16)})`);
    });
  } catch { console.log('Router getConfig() reverted'); }
}
main().catch(console.error);
