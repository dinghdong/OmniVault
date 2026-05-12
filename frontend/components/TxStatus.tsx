'use client';
import { useState } from 'react';
import { TransactionState } from '../hooks/useVaultTransactions';

export function explorerTxUrl(chainId: number, hash: string): string | null {
  if (chainId === 42161)  return `https://arbiscan.io/tx/${hash}`;
  if (chainId === 421614) return `https://sepolia.arbiscan.io/tx/${hash}`;
  if (chainId === 1)      return `https://etherscan.io/tx/${hash}`;
  return null;
}

function HashDisplay({ chainId, hash }: { chainId: number; hash: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  const url = explorerTxUrl(chainId, hash);

  const copy = () => {
    navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="txs-hash-row">
      <span className="txs-hash-label">TX</span>
      {url ? (
        <a className="txs-hash-value txs-hash-link" href={url} target="_blank" rel="noopener noreferrer">
          {short}
        </a>
      ) : (
        <span className="txs-hash-value" title={hash}>{short}</span>
      )}
      <button className="txs-copy-btn" onClick={copy} title="Copy hash">
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7l3.5 3.5L12 3" stroke="#00ff88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="4" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M1 5v7a1.5 1.5 0 001.5 1.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>
    </div>
  );
}

interface TxStatusProps {
  state: TransactionState;
  chainId: number;
  onReset: () => void;
  label: string; // "Deposit" | "Withdraw"
}

export default function TxStatus({ state, chainId, onReset, label }: TxStatusProps) {
  // signing — waiting for wallet approval
  if (state.isPending) {
    return (
      <div className="txs-screen">
        <div className="txs-icon-wrap txs-signing">
          <div className="txs-pulse-ring" />
          <div className="txs-pulse-ring txs-pulse-ring--2" />
          <div className="txs-pulse-ring txs-pulse-ring--3" />
          <div className="txs-icon-inner">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="8" width="24" height="16" rx="3" stroke="#00ff88" strokeWidth="2"/>
              <path d="M2 13h24" stroke="#00ff88" strokeWidth="2"/>
              <circle cx="7" cy="18" r="1.5" fill="#00ff88"/>
            </svg>
          </div>
        </div>
        <div className="txs-title">Confirm in Wallet</div>
        <div className="txs-subtitle">Open MetaMask and confirm the transaction</div>
        <div className="txs-steps">
          <div className="txs-step txs-step--active">
            <span className="txs-step-dot" />
            <span>Waiting for signature…</span>
          </div>
          <div className="txs-step txs-step--pending">
            <span className="txs-step-dot" />
            <span>On-chain confirmation</span>
          </div>
        </div>
      </div>
    );
  }

  // confirming — tx submitted, waiting for block
  if (state.isConfirming && state.hash) {
    return (
      <div className="txs-screen">
        <div className="txs-icon-wrap txs-confirming">
          <div className="txs-orbit" />
          <div className="txs-icon-inner">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M13 3v4M13 19v4M3 13h4M19 13h4" stroke="#00ff88" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="13" cy="13" r="5" stroke="#00ff88" strokeWidth="2"/>
            </svg>
          </div>
        </div>
        <div className="txs-title">Transaction Submitted</div>
        <div className="txs-subtitle">Waiting for on-chain confirmation…</div>
        <HashDisplay chainId={chainId} hash={state.hash} />
        <div className="txs-steps">
          <div className="txs-step txs-step--done">
            <svg className="txs-step-check" width="14" height="14" viewBox="0 0 14 14">
              <path d="M2 7l3.5 3.5L12 3" stroke="#00ff88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Wallet signed</span>
          </div>
          <div className="txs-step txs-step--active">
            <span className="txs-step-dot" />
            <span>Confirming on chain…</span>
          </div>
        </div>
      </div>
    );
  }

  // confirmed — success
  if (state.isConfirmed && state.hash) {
    return (
      <div className="txs-screen txs-screen--success">
        <div className="txs-icon-wrap txs-success">
          <svg className="txs-checkmark" width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="18" stroke="#00ff88" strokeWidth="2" opacity="0.3"/>
            <path
              className="txs-check-path"
              d="M10 20l7 7 13-14"
              stroke="#00ff88"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <div className="txs-success-glow" />
        </div>
        <div className="txs-title txs-title--success">{label} Confirmed!</div>
        <div className="txs-subtitle">Your transaction was included on-chain</div>
        <HashDisplay chainId={chainId} hash={state.hash} />
        <button className="txs-done-btn" onClick={onReset}>Done</button>
      </div>
    );
  }

  // error
  if (state.error) {
    const msg = state.error.length > 120 ? state.error.slice(0, 120) + '…' : state.error;
    return (
      <div className="txs-screen txs-screen--error">
        <div className="txs-icon-wrap txs-error">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="16" stroke="#ef4444" strokeWidth="2" opacity="0.4"/>
            <path d="M12 12l12 12M24 12L12 24" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="txs-title txs-title--error">Transaction Failed</div>
        <div className="txs-error-msg">{msg}</div>
        <button className="txs-retry-btn" onClick={onReset}>Try Again</button>
      </div>
    );
  }

  return null;
}
