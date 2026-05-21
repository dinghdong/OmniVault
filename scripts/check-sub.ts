import { ethers } from 'hardhat';

const ROUTER = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const SUB_ID = 6554;

const ROUTER_ABI = [
  'function getSubscription(uint64 subId) view returns (uint96 balance, uint96 blockedBalance, address owner, address[] memory consumers)',
];

async function main() {
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, ethers.provider);
  const sub = await router.getSubscription(SUB_ID);
  const balanceLink = Number(sub.balance) / 1e18;
  console.log(`Subscription #${SUB_ID}:`);
  console.log(`  Balance: ${sub.balance.toString()} juels = ${balanceLink.toFixed(4)} LINK`);
  console.log(`  Blocked: ${sub.blockedBalance.toString()} juels`);
  console.log(`  Owner:   ${sub.owner}`);
  console.log(`  Consumers: ${sub.consumers.join(', ') || '(none)'}`);
}
main().catch(console.error);
