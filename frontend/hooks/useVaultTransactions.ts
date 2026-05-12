'use client';
import { useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance, useChainId, useSwitchChain } from 'wagmi';
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
  const { address } = useAccount();
  const { data: ethBalance } = useBalance({ address });
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const isWrongChain = !!address && chainId !== contractChainId;

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
