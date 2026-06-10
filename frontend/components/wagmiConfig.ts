'use client';
import { createConfig, http } from 'wagmi';
import { sepolia, arbitrumSepolia, hardhat } from 'wagmi/chains';
import { getDefaultConfig } from 'connectkit';

const config = createConfig(
  getDefaultConfig({
    appName: 'OmniVault',
    appDescription: 'AI-Powered Decentralized Venture Capital — Chainlink × 0G Compute',
    appUrl: 'https://omnivault.xyz',
    appIcon: 'https://avatars.githubusercontent.com/u/37784886',
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '1edac01334b54f7548451183a21de5a8',
    chains: [arbitrumSepolia, sepolia, hardhat] as any,
    transports: {
      [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'),
      [sepolia.id]:         http(process.env.NEXT_PUBLIC_RPC_URL             || 'https://rpc.sepolia.org'),
      [hardhat.id]:         http('http://127.0.0.1:8545'),
    },
    enableAaveAccount: false,
  } as any)
);

export { config as wagmiConfig };
