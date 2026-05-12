'use client';
import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { ConnectKitProvider } from 'connectkit';
import { wagmiConfig } from './wagmiConfig';

const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#08090d',
        color: '#f0f2f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="rounded"
          customTheme={{
            '--ck-connectbutton-background': 'transparent',
            '--ck-connectbutton-color': '#08090d',
            '--ck-connectbutton-hover-background': 'transparent',
            '--ck-connectbutton-hover-color': '#08090d',
            '--ck-primary-button-background': 'transparent',
            '--ck-primary-button-color': '#08090d',
          }}
          options={{
            embedGoogleFonts: false,
            walletConnectName: 'WalletConnect',
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}