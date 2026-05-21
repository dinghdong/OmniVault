import { ethers } from 'hardhat';

const ROUTER = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';

const ABI = [
  'function getConfig() view returns (uint16 maxConsumersPerSubscription, uint96 adminFee, bytes4 handleOracleFulfillmentSelector, uint32[] callbackGasLimits)',
  'function typeAndVersion() view returns (string)',
];

async function main() {
  const provider = ethers.provider;
  const router = new ethers.Contract(ROUTER, ABI, provider);
  const ver = await router.typeAndVersion().catch(() => 'unknown');
  console.log('Router:', ver);
  const cfg = await router.getConfig().catch((e: any) => { console.log('getConfig err:', e.message); return null; });
  if (cfg) console.log('callbackGasLimits:', cfg);
}
main().catch(console.error);
