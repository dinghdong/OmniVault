/**
 * create-matches.ts
 *
 * Create several demo World Cup matches on MockPolyMarket for /agent-sim testing.
 * Reads MockPolyMarket address from frontend/.env.local.
 */
import { ethers } from 'hardhat';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../frontend/.env.local') });

interface MatchDef {
  home: string;
  away: string;
  homeOdds: string;
  drawOdds: string;
  awayOdds: string;
}

const MATCHES: MatchDef[] = [
  { home: 'Argentina', away: 'Brazil',     homeOdds: '2.30', drawOdds: '3.20', awayOdds: '3.10' },
  { home: 'Germany',   away: 'France',     homeOdds: '2.60', drawOdds: '3.10', awayOdds: '2.80' },
  { home: 'Spain',     away: 'Portugal',   homeOdds: '2.40', drawOdds: '3.00', awayOdds: '3.20' },
  { home: 'England',   away: 'Netherlands',homeOdds: '2.20', drawOdds: '3.30', awayOdds: '3.40' },
  { home: 'Italy',     away: 'Belgium',    homeOdds: '2.75', drawOdds: '3.10', awayOdds: '2.65' },
  { home: 'Japan',     away: 'South Korea',homeOdds: '2.90', drawOdds: '3.00', awayOdds: '2.60' },
];

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await signer.provider!.getNetwork();
  if (Number(network.chainId) !== 421614) throw new Error('Expected Arbitrum Sepolia');

  const marketAddr = process.env.NEXT_PUBLIC_MOCK_POLY_MARKET_ADDRESS;
  if (!marketAddr) throw new Error('Missing NEXT_PUBLIC_MOCK_POLY_MARKET_ADDRESS');

  const market = await ethers.getContractAt('MockPolyMarket', marketAddr);

  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 2 * 24 * 60 * 60; // 2 days from now

  for (const m of MATCHES) {
    const tx = await market.createMatch(
      m.home,
      m.away,
      ethers.parseEther(m.homeOdds),
      ethers.parseEther(m.drawOdds),
      ethers.parseEther(m.awayOdds),
      expiration
    );
    const receipt = await tx.wait();
    console.log(`Created ${m.home} vs ${m.away} (gas ${receipt.gasUsed})`);
  }

  console.log(`Total matches: ${await market.matchCount()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
