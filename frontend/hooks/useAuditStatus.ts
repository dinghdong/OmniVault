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
  statusNum:          number;
  statusLabel:        string;
  requestedAmount:    bigint;
  auditScore:         bigint;
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
  statusNum: 0, statusLabel: 'None',
  requestedAmount: BigInt(0),
  auditScore: BigInt(0), auditContentHash: '', auditAnalysis: null, auditFailed: false,
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
      // 1: OmniOracle.s_pendingRequest(projectId) — non-zero while Chainlink DON is running
      {
        address: omniOracleAddress,
        abi:     omniOracleAbi,
        functionName: 's_pendingRequest',
        args:    [BigInt(projectId ?? 0)],
      },
      // 2: OmniOracle.fulfilledScore(projectId) — non-zero once callback stored result
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
  const pendingRaw      = data?.[1];
  const fulfilledRaw    = data?.[2];

  if (!projectRaw || projectRaw.status !== 'success') {
    return { ...EMPTY, isLoading: false };
  }

  // viem may return a named object or a positional array — handle both
  const p   = projectRaw.result as any;
  const get = (name: string, idx: number) =>
    p[name] !== undefined ? p[name] : (Array.isArray(p) ? p[idx] : undefined);

  const statusNum   = Number(get('status', 4));
  const clRequestId = pendingRaw?.status === 'success'
    ? (pendingRaw.result as string)
    : null;
  const chainlinkPending = !!clRequestId && clRequestId !== ZERO_BYTES32;

  const auditScore    = get('auditScore', 5) as bigint;
  const auditAnalysis = parseAuditSummary(rawSummary);
  const auditFailed   = statusNum === 4 && auditScore === BigInt(0) && !auditAnalysis;

  // needsSettlement: oracle has stored result but IM is still "Auditing"
  const oracleFulfilled = fulfilledRaw?.status === 'success'
    ? BigInt(fulfilledRaw.result as bigint)
    : BigInt(0);
  const needsSettlement = statusNum === 2 && oracleFulfilled > BigInt(0);

  // Field indices match packed struct layout:
  // [0]applicant [1]commitHash [2]contractAddr [3]bizApi
  // [4]status [5]auditScore [6]submittedAt [7]auditedAt [8]investedAt [9]executionUnlocksAt [10]exitedAt
  // [11]requestedAmount [12]auditContentHash [13]investmentAmount [14]releasedAmount [15]exitProceeds
  return {
    applicant:          get('applicant',          0)  as string,
    commitHash:         get('commitHash',         1)  as string,
    contractAddr:       get('contractAddr',       2)  as string,
    bizApi:             get('bizApi',             3)  as string,
    statusNum,
    statusLabel:        PROJECT_STATUS[statusNum] ?? 'Unknown',
    requestedAmount:    get('requestedAmount',    11) as bigint,
    auditScore,
    auditContentHash:   get('auditContentHash',   12) as string,
    auditAnalysis,
    auditFailed,
    investmentAmount:   get('investmentAmount',   13) as bigint,
    releasedAmount:     get('releasedAmount',     14) as bigint,
    submittedAt:        BigInt(get('submittedAt', 6)  ?? 0),
    auditedAt:          BigInt(get('auditedAt',   7)  ?? 0),
    investedAt:         BigInt(get('investedAt',  8)  ?? 0),
    executionUnlocksAt: BigInt(get('executionUnlocksAt', 9) ?? 0),
    exitedAt:           BigInt(get('exitedAt',    10) ?? 0),
    exitProceeds:       get('exitProceeds',       15) as bigint,
    chainlinkPending,
    chainlinkRequestId: chainlinkPending ? clRequestId : null,
    needsSettlement,
    isLoading: false,
  };
}
