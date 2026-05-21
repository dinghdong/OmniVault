'use client';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { investmentManagerAddress, investmentManagerAbi } from './contracts';

// Veto is now called directly on InvestmentManager (RISK_AGENT_ROLE only)
export function useVeto() {
  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: waitError } =
    useWaitForTransactionReceipt({ hash });

  const veto = (projectId: number) => {
    writeContract({
      address: investmentManagerAddress,
      abi: investmentManagerAbi,
      functionName: 'veto' as any,
      args: [BigInt(projectId)],
    } as any);
  };

  return {
    veto,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error: writeError || waitError,
  };
}
