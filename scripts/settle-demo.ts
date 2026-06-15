/**
 * settle-demo.ts
 *
 * Top up MockPolyMarket and settle an existing bet order.
 * Reads addresses from frontend/.env.local.
 */
import { ethers } from 'hardhat';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../frontend/.env.local') });

async function main() {
  const [signer] = await ethers.getSigners();
  const projectId = process.argv[2] ? BigInt(process.argv[2]) : 4n;

  const vaultAddr = process.env.NEXT_PUBLIC_WORLD_CUP_AGENT_VAULT_ADDRESS;
  const marketAddr = process.env.NEXT_PUBLIC_MOCK_POLY_MARKET_ADDRESS;
  if (!vaultAddr || !marketAddr) throw new Error('Missing env addresses');

  console.log('Topping up MockPolyMarket with 0.01 ETH');
  const tx = await signer.sendTransaction({ to: marketAddr, value: ethers.parseEther('0.01') });
  await tx.wait();

  const vault = await ethers.getContractAt('WorldCupAgentVault', vaultAddr);
  console.log(`Settling project #${projectId}`);
  const stx = await vault.settleBetOrder(projectId);
  const receipt = await stx.wait();
  console.log('Settled, gas used:', receipt.gasUsed.toString());
}

main().catch(e => { console.error(e); process.exit(1); });
