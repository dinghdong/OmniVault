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
  statusNum: number;
  statusLabel: string;
  requestedAmount: bigint;
  auditScore: bigint;
  auditContentHash: string;  // SHA-256 of 3-round 0G Compute debate log
  investmentAmount: bigint;
  releasedAmount: bigint;
  submittedAt: bigint;
  auditedAt: bigint;
  investedAt: bigint;
  executionUnlocksAt: bigint;
  exitedAt: bigint;
  exitProceeds: bigint;
}

const EMPTY_PROJECT = (id: number): ProjectData => ({
  projectId: id, applicant: '', commitHash: '', contractAddr: '', bizApi: '',
  statusNum: 0, statusLabel: 'None',
  requestedAmount: BigInt(0), auditScore: BigInt(0), auditContentHash: '',
  investmentAmount: BigInt(0), releasedAmount: BigInt(0),
  submittedAt: BigInt(0), auditedAt: BigInt(0), investedAt: BigInt(0),
  executionUnlocksAt: BigInt(0), exitedAt: BigInt(0), exitProceeds: BigInt(0),
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
    const get = (name: string, idx: number) => p[name] !== undefined ? p[name] : p[idx];
    const statusNum = Number(get('status', 4));

    // Field indices match the packed struct layout (updated):
    // [0]applicant [1]commitHash [2]contractAddr [3]bizApi
    // [4]status(uint8) [5]auditScore(uint8) [6]submittedAt(uint40) [7]auditedAt(uint40)
    // [8]investedAt(uint40) [9]executionUnlocksAt(uint40) [10]exitedAt(uint40)
    // [11]requestedAmount [12]auditContentHash [13]investmentAmount [14]releasedAmount [15]exitProceeds
    return {
      projectId:          id,
      applicant:          get('applicant',          0)  as string,
      commitHash:         get('commitHash',         1)  as string,
      contractAddr:       get('contractAddr',       2)  as string,
      bizApi:             get('bizApi',             3)  as string,
      statusNum,
      statusLabel:        PROJECT_STATUS[statusNum] ?? 'Unknown',
      auditScore:         BigInt(get('auditScore',         5)  ?? 0),
      submittedAt:        BigInt(get('submittedAt',        6)  ?? 0),
      auditedAt:          BigInt(get('auditedAt',          7)  ?? 0),
      investedAt:         BigInt(get('investedAt',         8)  ?? 0),
      executionUnlocksAt: BigInt(get('executionUnlocksAt', 9)  ?? 0),
      exitedAt:           BigInt(get('exitedAt',           10) ?? 0),
      requestedAmount:    get('requestedAmount',    11) as bigint,
      auditContentHash:   String(get('auditContentHash',   12) ?? ''),
      investmentAmount:   get('investmentAmount',   13) as bigint,
      releasedAmount:     get('releasedAmount',     14) as bigint,
      exitProceeds:       get('exitProceeds',       15) as bigint,
    };
  });

  return { projects, isLoading, projectCount };
}
