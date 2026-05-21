'use client';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import {
  fundTokenAddress,
  investmentManagerAddress,
  investmentManagerAbi,
} from './contracts';

const fundTokenAbi = [
  { name: 'accrualFactor', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'totalSupply',   type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

export interface VaultStats {
  tvl: string;
  tvlEth: number;
  tvlChange: string;
  projectCount: number;
  aiScoreThreshold: number; // 0–100
  isLoading: boolean;
  isConfigured: boolean;
}

export function useVaultStats(): VaultStats {
  const isConfigured =
    !!fundTokenAddress &&
    fundTokenAddress !== '0x0000000000000000000000000000000000000000';

  const { data: accrualFactor, isLoading: l1 } = useReadContract({
    address: fundTokenAddress,
    abi: fundTokenAbi,
    functionName: 'accrualFactor',
    query: { enabled: isConfigured },
  });

  const { data: totalSupply, isLoading: l2 } = useReadContract({
    address: fundTokenAddress,
    abi: fundTokenAbi,
    functionName: 'totalSupply',
    query: { enabled: isConfigured },
  });

  const hasManager =
    isConfigured &&
    !!investmentManagerAddress &&
    investmentManagerAddress !== '0x0000000000000000000000000000000000000000';

  const { data: rawProjectCount, isLoading: l3 } = useReadContract({
    address: investmentManagerAddress,
    abi: investmentManagerAbi,
    functionName: 'projectCount',
    query: { enabled: hasManager },
  });

  const { data: rawScoreThreshold, isLoading: l4 } = useReadContract({
    address: investmentManagerAddress,
    abi: investmentManagerAbi,
    functionName: 'scoreThreshold',
    query: { enabled: hasManager },
  });

  const isLoading = l1 || l2 || l3 || l4;

  if (!isConfigured) {
    return { tvl: '--', tvlEth: 0, tvlChange: '--', projectCount: 0, aiScoreThreshold: 80, isLoading: false, isConfigured: false };
  }

  // TVL = totalSupply × accrualFactor / 1e18
  let tvl = '0 ETH';
  let tvlEth = 0;
  if (totalSupply !== undefined && accrualFactor !== undefined) {
    const tvlWei = (totalSupply as bigint) * (accrualFactor as bigint) / BigInt('1000000000000000000');
    tvlEth = Number(formatUnits(tvlWei, 18));
    tvl = tvlEth >= 1000
      ? `${(tvlEth / 1000).toFixed(2)}K ETH`
      : tvlEth > 0
        ? `${tvlEth.toFixed(4)} ETH`
        : '0 ETH';
  }

  // Cumulative yield = (accrualFactor / 1e18 - 1) × 100
  let tvlChange = '+0.00%';
  if (accrualFactor !== undefined) {
    const f = Number(accrualFactor as bigint);
    if (f > 0 && f < 1e38) {
      const pct = (f / 1e18 - 1) * 100;
      tvlChange = pct >= 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`;
    }
  }

  // Projects submitted to the AI audit pipeline
  const projectCount = rawProjectCount !== undefined
    ? Number(rawProjectCount as bigint)
    : 0;

  // AI minimum approval score (0–100 integer stored on-chain)
  const aiScoreThreshold = rawScoreThreshold !== undefined
    ? Number(rawScoreThreshold as bigint)
    : 80;

  return { tvl, tvlEth, tvlChange, projectCount, aiScoreThreshold, isLoading, isConfigured };
}
