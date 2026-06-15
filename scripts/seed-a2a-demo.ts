/**
 * seed-a2a-demo.ts
 *
 * Seeds an already deployed A2A demo with liquidity and a demo match.
 * Reads addresses from frontend/.env.local.
 *
 * Usage:
 *   npx hardhat run scripts/seed-a2a-demo.ts --network arbitrumSepolia
 */
import { ethers } from 'hardhat';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../frontend/.env.local') });

const FUND_VAULT_ETH = '0.02';
const MARKET_ETH     = '0.02';

async function waitTx(tx: any, label: string) {
  const receipt = await tx.wait();
  console.log(`  ✓ ${label} (gas: ${receipt.gasUsed})`);
  return receipt;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await signer.provider!.getNetwork();
  if (Number(network.chainId) !== 421614) throw new Error('Expected Arbitrum Sepolia');

  const fundVaultAddr = process.env.NEXT_PUBLIC_FUND_VAULT_ADDRESS;
  const marketAddr    = process.env.NEXT_PUBLIC_MOCK_POLY_MARKET_ADDRESS;
  if (!fundVaultAddr || !marketAddr) throw new Error('Missing env addresses');

  const fundVault = await ethers.getContractAt('FundVault', fundVaultAddr);
  const market    = await ethers.getContractAt('MockPolyMarket', marketAddr);

  console.log('Seeding FundVault with', FUND_VAULT_ETH, 'ETH');
  await waitTx(
    await fundVault.deposit({ value: ethers.parseEther(FUND_VAULT_ETH) }),
    `Deposit ${FUND_VAULT_ETH} ETH into FundVault`
  );

  console.log('Seeding MockPolyMarket with', MARKET_ETH, 'ETH');
  await waitTx(
    await signer.sendTransaction({ to: marketAddr, value: ethers.parseEther(MARKET_ETH) }),
    `Seed ${MARKET_ETH} ETH into MockPolyMarket`
  );

  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 7 * 24 * 60 * 60;
  await waitTx(
    await market.createMatch(
      'Argentina',
      'Brazil',
      ethers.parseEther('2.3'),
      ethers.parseEther('3.2'),
      ethers.parseEther('3.1'),
      expiration
    ),
    'Create demo match Argentina vs Brazil'
  );

  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
