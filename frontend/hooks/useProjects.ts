'use client';
import { useReadContract, useReadContracts } from 'wagmi';
import {
  investmentManagerAddress,
  investmentManagerAbi,
  PROJECT_STATUS,
} from './contracts';

export interface ProjectData {
  projectId: number;
  applicant: string;
  commitHash: string;
  contractAddr: string;
  bizApi: string;
  // A2A identity (v2)
  agentDid: string;
  agentRepo: string;
  agentApiEndpoint: string;
  // status
  statusNum: number;
  statusLabel: string;
  // 3D audit scores (v2)
  auditScore: number;
  reliabilityScore: number;
  qualityScore: number;
  marketFitScore: number;
  // timestamps
  submittedAt: bigint;
  auditedAt: bigint;
  investedAt: bigint;
  executionUnlocksAt: bigint;
  exitedAt: bigint;
  // amounts
  requestedAmount: bigint;
  auditContentHash: string;
  investmentAmount: bigint;
  releasedAmount: bigint;
  exitProceeds: bigint;
}

const EMPTY_PROJECT = (id: number): ProjectData => ({
  projectId: id,
  applicant: '', commitHash: '', contractAddr: '', bizApi: '',
  agentDid: '', agentRepo: '', agentApiEndpoint: '',
  statusNum: 0, statusLabel: 'None',
  auditScore: 0, reliabilityScore: 0, qualityScore: 0, marketFitScore: 0,
  submittedAt: 0n, auditedAt: 0n, investedAt: 0n,
  executionUnlocksAt: 0n, exitedAt: 0n,
  requestedAmount: 0n, auditContentHash: '',
  investmentAmount: 0n, releasedAmount: 0n, exitProceeds: 0n,
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
    })),
    query: { enabled: projectCount > 0, refetchInterval: 10_000 },
  });

  const projects: ProjectData[] = ids.map((id, i) => {
    const pr = projectResults?.[i];
    if (!pr || pr.status !== 'success') return EMPTY_PROJECT(id);

    const p = pr.result as any;

    // v2 struct layout (positional fallback when named access unavailable):
    // [0]  applicant          address
    // [1]  commitHash         bytes32
    // [2]  contractAddr       address
    // [3]  bizApi             string
    // [4]  agentDid           string   ← NEW
    // [5]  agentRepo          string   ← NEW
    // [6]  agentApiEndpoint   string   ← NEW
    // [7]  status             uint8
    // [8]  auditScore         uint8
    // [9]  reliabilityScore   uint8    ← NEW
    // [10] qualityScore       uint8    ← NEW
    // [11] marketFitScore     uint8    ← NEW
    // [12] submittedAt        uint40
    // [13] auditedAt          uint40
    // [14] investedAt         uint40
    // [15] executionUnlocksAt uint40
    // [16] exitedAt           uint40
    // [17] requestedAmount    uint256
    // [18] auditContentHash   bytes32
    // [19] investmentAmount   uint256
    // [20] releasedAmount     uint256
    // [21] exitProceeds       uint256
    const get = (name: string, idx: number) =>
      p[name] !== undefined ? p[name] : p[idx];

    const statusNum = Number(get('status', 7));

    return {
      projectId:          id,
      applicant:          String(get('applicant',          0)  ?? ''),
      commitHash:         String(get('commitHash',         1)  ?? ''),
      contractAddr:       String(get('contractAddr',       2)  ?? ''),
      bizApi:             String(get('bizApi',             3)  ?? ''),
      agentDid:           String(get('agentDid',           4)  ?? ''),
      agentRepo:          String(get('agentRepo',          5)  ?? ''),
      agentApiEndpoint:   String(get('agentApiEndpoint',   6)  ?? ''),
      statusNum,
      statusLabel:        PROJECT_STATUS[statusNum] ?? 'Unknown',
      auditScore:         Number(get('auditScore',         8)  ?? 0),
      reliabilityScore:   Number(get('reliabilityScore',   9)  ?? 0),
      qualityScore:       Number(get('qualityScore',       10) ?? 0),
      marketFitScore:     Number(get('marketFitScore',     11) ?? 0),
      submittedAt:        BigInt(get('submittedAt',        12) ?? 0),
      auditedAt:          BigInt(get('auditedAt',          13) ?? 0),
      investedAt:         BigInt(get('investedAt',         14) ?? 0),
      executionUnlocksAt: BigInt(get('executionUnlocksAt', 15) ?? 0),
      exitedAt:           BigInt(get('exitedAt',           16) ?? 0),
      requestedAmount:    BigInt(get('requestedAmount',    17) ?? 0),
      auditContentHash:   String(get('auditContentHash',   18) ?? ''),
      investmentAmount:   BigInt(get('investmentAmount',   19) ?? 0),
      releasedAmount:     BigInt(get('releasedAmount',     20) ?? 0),
      exitProceeds:       BigInt(get('exitProceeds',       21) ?? 0),
    };
  });

  return { projects, isLoading, projectCount };
}
