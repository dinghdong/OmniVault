'use client';
import { useState, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useVaultTransactions } from '../hooks/useVaultTransactions';
import { useVaultStats } from '../hooks/useVaultStats';
import TxStatus from './TxStatus';

export default function DepositModal() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { deposit, depositState, balances, resetDepositState, isWrongChain, switchToCorrectChain } = useVaultTransactions();
  const { tvlChange, isConfigured } = useVaultStats();
  const [amount, setAmount] = useState('');

  const isActive = depositState.isPending || depositState.isConfirming || depositState.isConfirmed || !!depositState.error;

  useEffect(() => {
    if (depositState.isConfirmed) setAmount('');
  }, [depositState.isConfirmed]);

  const handleDeposit = () => {
    if (!address || !amount || parseFloat(amount) <= 0) return;
    deposit(amount);
  };

  const handleReset = () => {
    resetDepositState();
    setAmount('');
  };

  if (isActive) {
    return (
      <TxStatus
        state={depositState}
        chainId={chainId}
        onReset={handleReset}
        label="Deposit"
      />
    );
  }

  return (
    <div className="action-form">
      {isWrongChain && (
        <div className="wrong-chain-banner">
          ⚠️ Wrong network — contracts are on Hardhat (31337).{' '}
          <button className="chain-switch-btn" onClick={switchToCorrectChain}>
            Switch Network
          </button>
        </div>
      )}

      <div className="input-group">
        <div className="input-header">
          <label className="input-label">Amount</label>
          <span className="input-balance">
            Balance: <strong>{parseFloat(balances.eth).toFixed(4)} ETH</strong>
          </span>
        </div>
        <div className="input-wrapper">
          <input
            type="number"
            className="input-field"
            placeholder="0.00"
            value={amount}
            min="0"
            step="0.01"
            onChange={e => setAmount(e.target.value)}
          />
          <span className="input-suffix">ETH</span>
          <button className="btn-max" onClick={() => setAmount(parseFloat(balances.eth).toFixed(4))}>
            MAX
          </button>
        </div>
      </div>

      <div className="info-box">
        <div className="info-row">
          <span className="info-label">Cumulative Yield</span>
          <span className="info-value accent">{isConfigured ? tvlChange : '—'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">You will receive</span>
          <span className="info-value">
            {amount && parseFloat(amount) > 0 ? parseFloat(amount).toFixed(4) : '0.0000'} FundToken
          </span>
        </div>
      </div>

      <button
        className="btn-primary btn-full"
        onClick={handleDeposit}
        disabled={!address || !amount || parseFloat(amount) <= 0 || isWrongChain}
      >
        Deposit ETH
      </button>

      {!address && (
        <div className="wallet-warning">Connect your wallet to deposit</div>
      )}
    </div>
  );
}
