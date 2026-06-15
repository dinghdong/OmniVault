'use client';
import { createConfig, http, fallback } from 'wagmi';
import { sepolia, arbitrumSepolia, hardhat } from 'wagmi/chains';
import { getDefaultConfig } from 'connectkit';

// Unconnected reads target the FIRST chain in the list — make sure that is the
// chain the contracts actually live on (NEXT_PUBLIC_CHAIN_ID).
const targetChainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '421614', 10);
const allChains = [arbitrumSepolia, sepolia, hardhat];
const orderedChains = [
  ...allChains.filter(c => c.id === targetChainId),
  ...allChains.filter(c => c.id !== targetChainId),
];

const config = createConfig(
  getDefaultConfig({
    appName: 'OmniVault',
    appDescription: 'AI-Powered Decentralized Venture Capital — Chainlink × 0G Compute',
    appUrl: 'https://omnivault.xyz',
    appIcon: 'https://avatars.githubusercontent.com/u/37784886',
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '1edac01334b54f7548451183a21de5a8',
    chains: orderedChains as any,
    transports: {
      // Multiple RPCs with automatic failover. publicnode is usually the most
      // accessible globally; official + tenderly are fallbacks.
      [arbitrumSepolia.id]: fallback([
        http('https://arbitrum-sepolia-rpc.publicnode.com'),
        http('https://sepolia-rollup.arbitrum.io/rpc'),
        http('https://arbitrum-sepolia.gateway.tenderly.co'),
        ...(process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL
          ? [http(process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL)]
          : []),
      ]),
      [sepolia.id]:  http(process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.sepolia.org'),
      [hardhat.id]:  http('http://127.0.0.1:8545'),
    },
    enableAaveAccount: false,
  } as any)
);

export { config as wagmiConfig };
