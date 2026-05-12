'use client';
import { createConfig, http } from 'wagmi';
import { getDefaultConfig } from 'connectkit';
import { defineChain } from 'viem';

// Local Hardhat node chain (chainId 31337)
const hardhat = defineChain({
  id: 31337,
  name: 'Hardhat',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
});

// Arbitrum Sepolia
const arbitrumSepolia = defineChain({
  id: 421614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' },
  },
});

// Arbitrum One
const arbitrum = defineChain({
  id: 42161,
  name: 'Arbitrum One',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://arb1.arbitrum.io/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Arbiscan', url: 'https://arbiscan.io' },
  },
});

const config = createConfig(
  getDefaultConfig({
    appName: 'OmniVault',
    appDescription: 'AI-Powered Decentralized Venture Capital',
    appUrl: 'https://omnivault.xyz',
    appIcon: 'https://avatars.githubusercontent.com/u/37784886',
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '1edac01334b54f7548451183a21de5a8',
    chains: [hardhat, arbitrum, arbitrumSepolia] as any,
    transports: {
      [hardhat.id]: http('http://127.0.0.1:8545'),
      [arbitrum.id]: http(),
      [arbitrumSepolia.id]: http(),
    },
    enableAaveAccount: false,
  } as any)
);

export { config as wagmiConfig };