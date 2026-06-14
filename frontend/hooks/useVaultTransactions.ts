'use client';
import { useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance, useSwitchChain } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { fundVaultAddress, fundVaultAbi, contractChainId } from './contracts';

export interface TransactionState {
  isLoading: boolean;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  error: string | null;
  hash: `0x${string}` | undefined;
}

export function useVaultTransactions() {
  // useAccount().chainId is the wallet's REAL chain (even when it's a chain
  // missing from the wagmi config) — useChainId() only reflects the config's
  // active chain and falls back to the default chain, masking mismatches.
  const { address, chainId: walletChainId } = useAccount();
  // Pin the balance read to the contracts' chain so a multi-chain wallet always
  // shows spendable Arbitrum Sepolia ETH (not whatever chain it's parked on).
  const { data: ethBalance } = useBalance({ address, chainId: contractChainId });
  const { switchChain } = useSwitchChain();

  const isWrongChain = !!address && walletChainId !== contractChainId;

  // ── Separate hooks for deposit and withdraw ──────────────────────────────
  const {
    writeContract: writeDeposit,
    data: depositTxHash,
    isPending: isDepositPending,
    error: depositWriteError,
    reset: resetDepositWrite,
  } = useWriteContract();

  const {
    writeContract: writeWithdraw,
    data: withdrawTxHash,
    isPending: isWithdrawPending,
    error: withdrawWriteError,
    reset: resetWithdrawWrite,
  } = useWriteContract();

  // ── Receipt watchers ─────────────────────────────────────────────────────
  const { isLoading: isDepositConfirming, isSuccess: isDepositConfirmed } =
    useWaitForTransactionReceipt({ hash: depositTxHash });

  const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawConfirmed } =
    useWaitForTransactionReceipt({ hash: withdrawTxHash });

  // ── deposit ──────────────────────────────────────────────────────────────
  const deposit = useCallback(
    (ethAmount?: string) => {
      if (!address) return;
      if (isWrongChain) { switchChain({ chainId: contractChainId }); return; }
      const amount = ethAmount || '1';
      const amountWei = parseUnits(amount, 18);
      writeDeposit({
        address: fundVaultAddress,
        abi: fundVaultAbi,
        functionName: 'deposit',
        chainId: contractChainId,
        value: amountWei,
        account: address,
      } as any);
    },
    [writeDeposit, address, isWrongChain, switchChain]
  );

  // ── withdraw ─────────────────────────────────────────────────────────────
  const withdraw = useCallback(
    (sharesAmount: string) => {
      if (!address || !sharesAmount || parseFloat(sharesAmount) <= 0) return;
      if (isWrongChain) { switchChain({ chainId: contractChainId }); return; }
      const shares = parseUnits(sharesAmount, 18);
      writeWithdraw({
        address: fundVaultAddress,
        abi: fundVaultAbi,
        functionName: 'redeem',
        chainId: contractChainId,
        args: [shares],
        account: address,
      } as any);
    },
    [writeWithdraw, address, isWrongChain, switchChain]
  );

  const resetDepositState = useCallback(() => resetDepositWrite(), [resetDepositWrite]);
  const resetWithdrawState = useCallback(() => resetWithdrawWrite(), [resetWithdrawWrite]);

  const userEthBalance = ethBalance ? formatUnits(ethBalance.value, 18) : '0';

  const depositState: TransactionState = {
    isLoading: isDepositPending || isDepositConfirming,
    isPending: isDepositPending,
    isConfirming: isDepositConfirming,
    isConfirmed: isDepositConfirmed,
    error: depositWriteError ? (depositWriteError as Error).message : null,
    hash: depositTxHash,
  };

  const withdrawState: TransactionState = {
    isLoading: isWithdrawPending || isWithdrawConfirming,
    isPending: isWithdrawPending,
    isConfirming: isWithdrawConfirming,
    isConfirmed: isWithdrawConfirmed,
    error: withdrawWriteError ? (withdrawWriteError as Error).message : null,
    hash: withdrawTxHash,
  };

  return {
    deposit,
    withdraw,
    depositState,
    withdrawState,
    resetDepositState,
    resetWithdrawState,
    isWrongChain,
    switchToCorrectChain: () => switchChain({ chainId: contractChainId }),
    balances: {
      eth: userEthBalance,
    },
  };
}
