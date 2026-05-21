'use client';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { investmentManagerAddress, investmentManagerAbi } from './contracts';

export function useClaimPayout(projectId: number, enabled = true) {
  const { data: progressData, isLoading: progressLoading } = useReadContract({
    address: investmentManagerAddress,
    abi: investmentManagerAbi,
    functionName: 'vestingProgress',
    args: [BigInt(projectId)],
    query: { enabled: enabled && projectId > 0, refetchInterval: 15_000 },
  });

  const { data: claimableRaw, isLoading: claimableLoading } = useReadContract({
    address: investmentManagerAddress,
    abi: investmentManagerAbi,
    functionName: 'getClaimableAmount',
    args: [BigInt(projectId)],
    query: { enabled: enabled && projectId > 0, refetchInterval: 15_000 },
  });

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: waitError } =
    useWaitForTransactionReceipt({ hash });

  const claim = () => {
    writeContract({
      address: investmentManagerAddress,
      abi: investmentManagerAbi,
      functionName: 'claimPayout',
      args: [BigInt(projectId)],
    } as any);
  };

  const progress = progressData as readonly [bigint, bigint, bigint, bigint] | undefined;

  return {
    vestedBps:   progress?.[0] ?? BigInt(0),
    claimable:   (claimableRaw as bigint | undefined) ?? BigInt(0),
    released:    progress?.[2] ?? BigInt(0),
    total:       progress?.[3] ?? BigInt(0),
    isLoading:   progressLoading || claimableLoading,
    claim,
    isPending,
    isConfirming,
    isConfirmed,
    error: writeError || waitError,
  };
}
