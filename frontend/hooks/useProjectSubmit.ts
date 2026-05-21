'use client';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useCallback, useEffect, useState } from 'react';
import { decodeEventLog } from 'viem';
import {
  investmentManagerAbi,
  investmentManagerAddress,
  contractChainId,
} from './contracts';

export interface SubmitState {
  isPending:    boolean;
  isConfirming: boolean;
  isConfirmed:  boolean;
  hash:         `0x${string}` | undefined;
  projectId:    number | null;   // parsed from ProjectSubmitted event
  error:        string | null;
}

const idle: SubmitState = {
  isPending: false, isConfirming: false, isConfirmed: false,
  hash: undefined, projectId: null, error: null,
};

export function useProjectSubmit() {
  const [state, setState] = useState<SubmitState>(idle);

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  // ── Sync wagmi state → local state ────────────────────────────────────────
  useEffect(() => {
    if (isPending) setState(s => ({ ...s, isPending: true, error: null }));
  }, [isPending]);

  useEffect(() => {
    if (txHash) setState(s => ({ ...s, hash: txHash, isPending: false, isConfirming: true }));
  }, [txHash]);

  // Parse ProjectSubmitted event → extract projectId
  useEffect(() => {
    if (!receipt || !isConfirmed) return;

    let projectId: number | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== investmentManagerAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: investmentManagerAbi,
          data: log.data,
          topics: log.topics as any,
        }) as unknown as { eventName: string; args: Record<string, unknown> };
        if (decoded.eventName === 'ProjectSubmitted') {
          projectId = Number(decoded.args.projectId);
          break;
        }
      } catch { /* different event */ }
    }

    setState(s => ({ ...s, isPending: false, isConfirming: false, isConfirmed: true, projectId }));
  }, [receipt, isConfirmed]);

  useEffect(() => {
    if (writeError) {
      const msg =
        (writeError as any)?.shortMessage ||
        (writeError as any)?.message ||
        'Transaction failed';
      console.error('[useProjectSubmit] writeError:', writeError);
      setState(s => ({ ...s, isPending: false, isConfirming: false, error: msg }));
    }
  }, [writeError]);

  const submit = useCallback((
    commitHash:      `0x${string}`,
    contractAddr:    string,
    bizApi:          string,
    requestedAmount: bigint,
  ) => {
    setState(idle);
    writeContract({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'submitProject',
      chainId:      contractChainId,
      args:         [commitHash, contractAddr as `0x${string}`, bizApi, requestedAmount],
    } as any);
  }, [writeContract]);

  const reset = useCallback(() => {
    resetWrite();
    setState(idle);
  }, [resetWrite]);

  return { submit, state, reset };
}
