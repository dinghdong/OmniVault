'use client';
import { useAccount, useDisconnect, useConnect } from 'wagmi';
import { useModal } from 'connectkit';
import { useEffect } from 'react';

export default function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectors } = useConnect();
  const { setOpen } = useModal();

  // Expose test helpers on window so Playwright tests can trigger connection
  // without depending on the ConnectKit modal flow.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__test_connectors = connectors.map((c) => ({
      id: c.id,
      type: (c as any).type,
      name: c.name,
    }));
    (window as any).__test_connect = () => {
      const inj = connectors.find(
        (c) => (c as any).type === 'injected' || c.id === 'injected' || c.id === 'io.metamask'
      );
      if (inj) {
        connect({ connector: inj });
        return `connecting with ${inj.id}`;
      }
      // Fallback: try any connector
      if (connectors[0]) {
        connect({ connector: connectors[0] });
        return `connecting with ${connectors[0].id} (fallback)`;
      }
      return 'no connector found';
    };
  }, [connectors, connect]);

  const handleClick = () => {
    if (isConnected) {
      disconnect();
    } else {
      // Always open the ConnectKit modal so users can pick their wallet.
      // Auto-connecting to an injected provider breaks when multiple wallets
      // (MetaMask + Rabby) are installed or when injection is in a bad state.
      setOpen(true);
    }
  };

  return (
    <>
      {isConnected && address ? (
        <button className="wallet-btn connected" onClick={handleClick}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="10" fill="#00ff88"/>
            <circle cx="10" cy="10" r="4" fill="#08090d"/>
          </svg>
          <span>{address.slice(0, 6)}...{address.slice(-4)}</span>
        </button>
      ) : (
        <button className="wallet-btn" onClick={handleClick}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect width="20" height="20" rx="4" fill="#08090d"/>
            <path d="M10 6v8M6 10h8" stroke="#00ff88" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span>Connect Wallet</span>
        </button>
      )}
    </>
  );
}
