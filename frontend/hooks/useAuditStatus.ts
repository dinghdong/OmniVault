'use client';
import { useEffect, useState } from 'react';
import { useReadContracts, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import {
  investmentManagerAddress,
  investmentManagerAbi,
  omniOracleAddress,
  omniOracleAbi,
  PROJECT_STATUS,
} from './contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditAnalysis {
  scores:         number[];          // [s1, s2, s3, final]
  recommendation: string;            // "APPROVE" | "REJECT"
  rationale:      string;            // one-sentence rationale
  findings:       string[];          // security findings
  risks:          string[];          // risk factors
}

export interface AuditStatus {
  // On-chain project data
  applicant:          string;
  commitHash:         string;
  contractAddr:       string;
  bizApi:             string;
  // AI Agent metadata (v2)
  agentDid:           string;
  agentRepo:          string;
  agentApiEndpoint:   string;
  statusNum:          number;
  statusLabel:        string;
  requestedAmount:    bigint;
  auditScore:         number;    // uint8 [0,100]
  reliabilityScore:   number;    // 3D dimension — reliability
  qualityScore:       number;    // 3D dimension — quality
  marketFitScore:     number;    // 3D dimension — market fit
  auditContentHash:   string;
  auditAnalysis:      AuditAnalysis | null;
  auditFailed:        boolean;
  investmentAmount:   bigint;
  releasedAmount:     bigint;
  submittedAt:        bigint;
  auditedAt:          bigint;
  investedAt:         bigint;
  executionUnlocksAt: bigint;
  exitedAt:           bigint;
  exitProceeds:       bigint;
  // Chainlink Functions state
  chainlinkPending:   boolean;
  chainlinkRequestId: string | null;
  // Two-transaction settle: oracle has result but IM not yet settled
  needsSettlement:    boolean;
  // Loading state
  isLoading:          boolean;
}

const ZERO_BYTES32 = '0x' + '0'.repeat(64);

// AuditReport event: emitted by OmniOracle after Chainlink fulfillment
const AUDIT_REPORT_EVENT = parseAbiItem(
  'event AuditReport(uint256 indexed projectId, string summary)'
);

// Sepolia block from around when OmniVault contracts first deployed — limits getLogs range
const DEPLOY_FROM_BLOCK = BigInt(8_000_000);

function parseAuditSummary(raw: string): AuditAnalysis | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return {
      scores:         Array.isArray(j.s) ? j.s.map(Number) : [],
      recommendation: typeof j.r === 'string' ? j.r : '',
      rationale:      typeof j.t === 'string' ? j.t : '',
      findings:       Array.isArray(j.f) ? j.f : [],
      risks:          Array.isArray(j.k) ? j.k : [],
    };
  } catch {
    return null;
  }
}

const EMPTY: AuditStatus = {
  applicant: '', commitHash: '', contractAddr: '', bizApi: '',
  agentDid: '', agentRepo: '', agentApiEndpoint: '',
  statusNum: 0, statusLabel: 'None',
  requestedAmount: BigInt(0),
  auditScore: 0, reliabilityScore: 0, qualityScore: 0, marketFitScore: 0,
  auditContentHash: '', auditAnalysis: null, auditFailed: false,
  investmentAmount: BigInt(0), releasedAmount: BigInt(0),
  submittedAt: BigInt(0), auditedAt: BigInt(0),
  investedAt: BigInt(0), executionUnlocksAt: BigInt(0),
  exitedAt: BigInt(0), exitProceeds: BigInt(0),
  chainlinkPending: false, chainlinkRequestId: null,
  needsSettlement: false,
  isLoading: true,
};

const POLL_INTERVAL_MS = 8_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuditStatus(projectId: number | null): AuditStatus {
  const enabled = projectId !== null && projectId > 0;

  const publicClient = usePublicClient();
  const [rawSummary, setRawSummary] = useState<string>('');
  const [summaryFetched, setSummaryFetched] = useState(false);

  const { data, isLoading } = useReadContracts({
    contracts: [
      // 0: InvestmentManager.projects(projectId)
      {
        address: investmentManagerAddress,
        abi:     investmentManagerAbi,
        functionName: 'projects',
        args:    [BigInt(projectId ?? 0)],
      },
      // 1: OmniOracle.fulfilledScore(projectId) — non-zero once callback stored result
      {
        address: omniOracleAddress,
        abi:     omniOracleAbi,
        functionName: 'fulfilledScore',
        args:    [BigInt(projectId ?? 0)],
      },
    ],
    query: {
      enabled,
      refetchInterval: POLL_INTERVAL_MS,
    },
  });

  // Read AuditReport event log for this project (cheaper than storage, avoids callback gas)
  useEffect(() => {
    if (!enabled || !publicClient || summaryFetched) return;

    publicClient.getLogs({
      address: omniOracleAddress,
      event:   AUDIT_REPORT_EVENT,
      args:    { projectId: BigInt(projectId!) },
      fromBlock: DEPLOY_FROM_BLOCK,
    }).then(logs => {
      if (logs.length > 0) {
        const last = logs[logs.length - 1];
        setRawSummary((last.args as { summary?: string }).summary ?? '');
        setSummaryFetched(true);
      }
    }).catch(() => {});
  }, [enabled, publicClient, projectId, summaryFetched]);

  // Re-fetch when status transitions out of "Auditing" (statusNum 2 → 3/4)
  const statusNum0 = data?.[0]?.status === 'success'
    ? Number((data[0].result as any)?.status ?? (data[0].result as any)?.[4] ?? 0)
    : 0;
  useEffect(() => {
    if (statusNum0 >= 3) setSummaryFetched(false);
  }, [statusNum0]);

  if (!enabled || isLoading) return { ...EMPTY, isLoading };

  const projectRaw      = data?.[0];
  const fulfilledRaw    = data?.[1];

  if (!projectRaw || projectRaw.status !== 'success') {
    return { ...EMPTY, isLoading: false };
  }

  // viem may return a named object or a positional array — handle both
  const p   = projectRaw.result as any;
  const get = (name: string, idx: number) =>
    p[name] !== undefined ? p[name] : (Array.isArray(p) ? p[idx] : undefined);

  const statusNum   = Number(get('status', 7));
  // chainlinkPending: true while project is in Auditing state (status=2)
  const chainlinkPending = statusNum === 2;

  // Named access preferred; positional fallback for new struct layout (v2):
  // [0]applicant [1]commitHash [2]contractAddr [3]bizApi
  // [4]agentDid [5]agentRepo [6]agentApiEndpoint
  // [7]status [8]auditScore [9]reliabilityScore [10]qualityScore [11]marketFitScore
  // [12]submittedAt [13]auditedAt [14]investedAt [15]executionUnlocksAt [16]exitedAt
  // [17]requestedAmount [18]auditContentHash [19]investmentAmount [20]releasedAmount [21]exitProceeds
  const auditScore      = Number(get('auditScore',       8)  ?? 0);
  const reliabilityScore = Number(get('reliabilityScore', 9)  ?? 0);
  const qualityScore    = Number(get('qualityScore',     10) ?? 0);
  const marketFitScore  = Number(get('marketFitScore',   11) ?? 0);
  const auditAnalysis   = parseAuditSummary(rawSummary);
  const auditFailed     = statusNum === 4 && auditScore === 0 && !auditAnalysis;

  // needsSettlement: oracle has stored result but IM is still "Auditing"
  const oracleFulfilled = fulfilledRaw?.status === 'success'
    ? BigInt(fulfilledRaw.result as bigint)
    : BigInt(0);
  const needsSettlement = statusNum === 2 && oracleFulfilled > BigInt(0);

  return {
    applicant:          get('applicant',          0)  as string,
    commitHash:         get('commitHash',         1)  as string,
    contractAddr:       get('contractAddr',       2)  as string,
    bizApi:             get('bizApi',             3)  as string,
    agentDid:           (get('agentDid',          4)  as string) || '',
    agentRepo:          (get('agentRepo',         5)  as string) || '',
    agentApiEndpoint:   (get('agentApiEndpoint',  6)  as string) || '',
    statusNum,
    statusLabel:        PROJECT_STATUS[statusNum] ?? 'Unknown',
    requestedAmount:    get('requestedAmount',    17) as bigint,
    auditScore,
    reliabilityScore,
    qualityScore,
    marketFitScore,
    auditContentHash:   get('auditContentHash',   18) as string,
    auditAnalysis,
    auditFailed,
    investmentAmount:   get('investmentAmount',   19) as bigint,
    releasedAmount:     get('releasedAmount',     20) as bigint,
    submittedAt:        BigInt(get('submittedAt', 12) ?? 0),
    auditedAt:          BigInt(get('auditedAt',   13) ?? 0),
    investedAt:         BigInt(get('investedAt',  14) ?? 0),
    executionUnlocksAt: BigInt(get('executionUnlocksAt', 15) ?? 0),
    exitedAt:           BigInt(get('exitedAt',    16) ?? 0),
    exitProceeds:       get('exitProceeds',       21) as bigint,
    chainlinkPending,
    chainlinkRequestId: null,
    needsSettlement,
    isLoading: false,
  };
}
