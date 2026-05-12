'use client';
import { useAccount, useSwitchChain } from 'wagmi';
import { useState } from 'react';

export default function NetworkSelector() {
  const { address, chain } = useAccount();
  const chainId = chain?.id;
  const { switchChain, isPending } = useSwitchChain();
  const [isOpen, setIsOpen] = useState(false);

  const supportedChains = [
    { id: 1, name: 'Ethereum', icon: '⟳' },
    { id: 11155111, name: 'Sepolia', icon: '⟡' },
    { id: 42161, name: 'Arbitrum', icon: '◆' },
    { id: 421614, name: 'Arbitrum Sepolia', icon: '◇' },
    { id: 31337, name: 'Hardhat', icon: '⚒' },
  ];

  const isUnsupported = !!chainId && !supportedChains.find(c => c.id === chainId);
  const currentChain = supportedChains.find(c => c.id === chainId) || { id: chainId, name: chain?.name || 'Unknown', icon: '?' };

  if (!address) return null;

  return (
    <div className="network-selector">
      <button
        className="network-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
      >
        <span className="network-icon">{currentChain.icon}</span>
        <span className="network-name">{currentChain.name}</span>
        <span className={`network-indicator ${isUnsupported ? 'unsupported' : ''}`}></span>
      </button>

      {isOpen && (
        <>
          <div className="network-overlay" onClick={() => setIsOpen(false)} />
          <div className="network-dropdown">
            <div className="network-dropdown-header">Select Network</div>
            {supportedChains.map((network) => (
              <button
                key={network.id}
                className={`network-option ${chainId === network.id ? 'active' : ''}`}
                onClick={() => {
                  switchChain({ chainId: network.id });
                  setIsOpen(false);
                }}
              >
                <span className="network-icon">{network.icon}</span>
                <span className="network-name">{network.name}</span>
                {chainId === network.id && <span className="network-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
