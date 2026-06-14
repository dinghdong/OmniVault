'use client';
import { useState, useEffect } from 'react';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useVaultTransactions } from '../hooks/useVaultTransactions';
import { fundTokenAbi, fundTokenAddress, contractChainId } from '../hooks/contracts';
import TxStatus from './TxStatus';

const getSharesAbi = [
  {
    name: 'getShares',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export default function WithdrawModal() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { withdraw, withdrawState, resetWithdrawState, isWrongChain, switchToCorrectChain } = useVaultTransactions();
  const [amount, setAmount] = useState('');

  const { data: rawShares, refetch: refetchShares } = useReadContract({
    address: fundTokenAddress,
    abi: getSharesAbi,
    functionName: 'getShares',
    args: [address as `0x${string}`],
    chainId: contractChainId,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const { data: ftBalance } = useReadContract({
    address: fundTokenAddress,
    abi: fundTokenAbi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    chainId: contractChainId,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const userShares  = rawShares  ? formatUnits(rawShares  as bigint, 18) : '0';
  const userEthVal  = ftBalance  ? parseFloat(formatUnits(ftBalance as bigint, 18)).toFixed(4) : '0.0000';

  const isActive = withdrawState.isPending || withdrawState.isConfirming || withdrawState.isConfirmed || !!withdrawState.error;

  useEffect(() => {
    if (withdrawState.isConfirmed) {
      setAmount('');
      refetchShares();
    }
  }, [withdrawState.isConfirmed, refetchShares]);

  const handleWithdraw = () => {
    if (!address || !amount || parseFloat(amount) <= 0) return;
    withdraw(amount);
  };

  const handleReset = () => {
    resetWithdrawState();
    setAmount('');
  };

  if (isActive) {
    return (
      <TxStatus
        state={withdrawState}
        chainId={chainId}
        onReset={handleReset}
        label="Withdrawal"
      />
    );
  }

  const ethOut = amount && parseFloat(amount) > 0
    ? parseFloat(formatUnits(BigInt(Math.floor(parseFloat(amount) * 1e18)), 18)).toFixed(4)
    : '0.0000';

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
          <label className="input-label">Shares to Redeem</label>
          <span className="input-balance">
            <strong>{parseFloat(userShares).toFixed(4)}</strong> shares ≈ {userEthVal} ETH
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
          <span className="input-suffix">OVFT</span>
          <button
            className="btn-max"
            onClick={() => rawShares && setAmount(formatUnits(rawShares as bigint, 18))}
            disabled={!rawShares}
          >
            MAX
          </button>
        </div>
      </div>

      <div className="info-box">
        <div className="info-row">
          <span className="info-label">Your FundToken balance</span>
          <span className="info-value">{userEthVal} ETH</span>
        </div>
        <div className="info-row">
          <span className="info-label">You will receive</span>
          <span className="info-value accent">≈ {ethOut} ETH</span>
        </div>
      </div>

      <button
        className="btn-primary btn-full"
        onClick={handleWithdraw}
        disabled={!address || !amount || parseFloat(amount) <= 0 || isWrongChain}
      >
        Withdraw ETH
      </button>

      {!address && (
        <div className="wallet-warning">Connect your wallet to withdraw</div>
      )}
    </div>
  );
}
