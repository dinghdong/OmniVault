'use client';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useCallback, useState } from 'react';
import { investmentManagerAbi, investmentManagerAddress } from './contracts';

export interface SubmitState {
  isPending:    boolean;
  isConfirming: boolean;
  isConfirmed:  boolean;
  hash:         `0x${string}` | undefined;
  projectId:    number | null;
  error:        string | null;
}

const idle: SubmitState = {
  isPending: false, isConfirming: false, isConfirmed: false,
  hash: undefined, projectId: null, error: null,
};

export function useProjectSubmit() {
  const [state, setState] = useState<SubmitState>(idle);

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  // Sync wagmi state → local state
  if (isPending && !state.isPending) {
    setState(s => ({ ...s, isPending: true, error: null }));
  }
  if (txHash && txHash !== state.hash) {
    setState(s => ({ ...s, hash: txHash, isPending: false, isConfirming: true }));
  }
  if (isConfirmed && !state.isConfirmed) {
    setState(s => ({ ...s, isConfirming: false, isConfirmed: true }));
  }
  if (writeError && !state.error) {
    const msg = (writeError as any)?.shortMessage || writeError.message || 'Transaction failed';
    setState(s => ({ ...s, isPending: false, isConfirming: false, error: msg }));
  }

  const submit = useCallback((
    commitHash:   `0x${string}`,  // keccak256 of file bytes, already bytes32
    contractAddr: string,
    bizApi:       string,
  ) => {
    setState(idle);
    writeContract({
      address: investmentManagerAddress,
      abi: investmentManagerAbi,
      functionName: 'submitProject',
      args: [commitHash, contractAddr as `0x${string}`, bizApi],
    } as any);
  }, [writeContract]);

  const reset = useCallback(() => setState(idle), []);

  return { submit, state, reset };
}
