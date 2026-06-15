'use client';
import { useReadContract, useReadContracts } from 'wagmi';
import {
  investmentManagerAddress,
  investmentManagerAbi,
  PROJECT_STATUS,
  contractChainId,
} from './contracts';

export interface ProjectData {
  projectId: number;
  applicant: string;
  contractAddr: string;
  requestedAmount: bigint;
  fundedAmount: bigint;
  agentId: bigint;
  initData: string;
  statusNum: number;
  statusLabel: string;
  auditScore: number;
  reliabilityScore: number;
  qualityScore: number;
  marketFitScore: number;
  submittedAt: bigint;
  auditedAt: bigint;
  executionUnlocksAt: bigint;
  settledAt: bigint;
  auditContentHash: string;
  returnedAmount: bigint;
}

const EMPTY_PROJECT = (id: number): ProjectData => ({
  projectId: id,
  applicant: '', contractAddr: '',
  requestedAmount: 0n, fundedAmount: 0n, agentId: 0n, initData: '',
  statusNum: 0, statusLabel: 'None',
  auditScore: 0, reliabilityScore: 0, qualityScore: 0, marketFitScore: 0,
  submittedAt: 0n, auditedAt: 0n,
  executionUnlocksAt: 0n, settledAt: 0n,
  auditContentHash: '', returnedAmount: 0n,
});

/** Auto-fetches projectCount if not provided. */
export function useProjects(externalCount?: number) {
  const hasManager =
    !!investmentManagerAddress &&
    investmentManagerAddress !== '0x0000000000000000000000000000000000000000';

  const { data: rawCount } = useReadContract({
    address: investmentManagerAddress,
    abi: investmentManagerAbi,
    functionName: 'projectCount',
    chainId: contractChainId,
    query: { enabled: hasManager && externalCount === undefined, refetchInterval: 10_000 },
  });

  const projectCount = externalCount ?? (rawCount !== undefined ? Number(rawCount as bigint) : 0);
  const ids = Array.from({ length: projectCount }, (_, i) => i + 1);

  const { data: projectResults, isLoading } = useReadContracts({
    contracts: ids.map(id => ({
      address: investmentManagerAddress,
      abi: investmentManagerAbi,
      functionName: 'projects' as const,
      args: [BigInt(id)] as const,
      chainId: contractChainId,
    })),
    query: { enabled: projectCount > 0, refetchInterval: 10_000 },
  });

  const projects: ProjectData[] = ids.map((id, i) => {
    const pr = projectResults?.[i];
    if (!pr || pr.status !== 'success') return EMPTY_PROJECT(id);

    const p = pr.result as any;

    // New A2A struct layout:
    // [0]  applicant          address
    // [1]  contractAddr       address
    // [2]  requestedAmount    uint256
    // [3]  fundedAmount       uint256
    // [4]  agentId            uint256
    // [5]  initData           bytes
    // [6]  status             uint8
    // [7]  auditScore         uint8
    // [8]  reliabilityScore   uint8
    // [9]  qualityScore       uint8
    // [10] marketFitScore     uint8
    // [11] submittedAt        uint40
    // [12] auditedAt          uint40
    // [13] executionUnlocksAt uint40
    // [14] settledAt          uint40
    // [15] auditContentHash   bytes32
    // [16] returnedAmount     uint256
    const get = (name: string, idx: number) =>
      p[name] !== undefined ? p[name] : p[idx];

    const statusNum = Number(get('status', 6));

    return {
      projectId:          id,
      applicant:          String(get('applicant',          0)  ?? ''),
      contractAddr:       String(get('contractAddr',       1)  ?? ''),
      requestedAmount:    BigInt(get('requestedAmount',    2)  ?? 0),
      fundedAmount:       BigInt(get('fundedAmount',       3)  ?? 0),
      agentId:            BigInt(get('agentId',            4)  ?? 0),
      initData:           String(get('initData',           5)  ?? ''),
      statusNum,
      statusLabel:        PROJECT_STATUS[statusNum] ?? 'Unknown',
      auditScore:         Number(get('auditScore',         7)  ?? 0),
      reliabilityScore:   Number(get('reliabilityScore',   8)  ?? 0),
      qualityScore:       Number(get('qualityScore',       9)  ?? 0),
      marketFitScore:     Number(get('marketFitScore',     10) ?? 0),
      submittedAt:        BigInt(get('submittedAt',        11) ?? 0),
      auditedAt:          BigInt(get('auditedAt',          12) ?? 0),
      executionUnlocksAt: BigInt(get('executionUnlocksAt', 13) ?? 0),
      settledAt:          BigInt(get('settledAt',          14) ?? 0),
      auditContentHash:   String(get('auditContentHash',   15) ?? ''),
      returnedAmount:     BigInt(get('returnedAmount',     16) ?? 0),
    };
  });

  return { projects, isLoading, projectCount };
}
