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
  contractChainId,
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
  contractAddr:       string;
  requestedAmount:    bigint;
  fundedAmount:       bigint;
  returnedAmount:     bigint;
  agentId:            bigint;
  initData:           string;
  statusNum:          number;
  statusLabel:        string;
  auditScore:         number;    // uint8 [0,100]
  reliabilityScore:   number;    // 3D dimension — reliability
  qualityScore:       number;    // 3D dimension — quality
  marketFitScore:     number;    // 3D dimension — market fit
  auditContentHash:   string;
  auditAnalysis:      AuditAnalysis | null;
  auditFailed:        boolean;
  submittedAt:        bigint;
  auditedAt:          bigint;
  executionUnlocksAt: bigint;
  settledAt:          bigint;
  // Chainlink Functions state
  chainlinkPending:   boolean;
  chainlinkRequestId: string | null;
  // Two-transaction settle: oracle has result but IM not yet settled
  needsSettlement:    boolean;
  // Loading state
  isLoading:          boolean;
  // Backwards-compatible aliases used by legacy UI panels
  investmentAmount:   bigint;
  releasedAmount:     bigint;
  exitProceeds:       bigint;
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
  applicant: '', contractAddr: '', requestedAmount: BigInt(0),
  fundedAmount: BigInt(0), returnedAmount: BigInt(0),
  agentId: BigInt(0), initData: '',
  statusNum: 0, statusLabel: 'None',
  auditScore: 0, reliabilityScore: 0, qualityScore: 0, marketFitScore: 0,
  auditContentHash: '', auditAnalysis: null, auditFailed: false,
  submittedAt: BigInt(0), auditedAt: BigInt(0),
  executionUnlocksAt: BigInt(0), settledAt: BigInt(0),
  chainlinkPending: false, chainlinkRequestId: null,
  needsSettlement: false,
  isLoading: true,
  investmentAmount: BigInt(0), releasedAmount: BigInt(0), exitProceeds: BigInt(0),
};

const POLL_INTERVAL_MS = 8_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuditStatus(projectId: number | null): AuditStatus {
  const enabled = projectId !== null && projectId > 0;

  const publicClient = usePublicClient({ chainId: contractChainId });
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
        chainId: contractChainId,
      },
      // 1: OmniOracle.fulfilledScore(projectId) — non-zero once callback stored result
      {
        address: omniOracleAddress,
        abi:     omniOracleAbi,
        functionName: 'fulfilledScore',
        args:    [BigInt(projectId ?? 0)],
        chainId: contractChainId,
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

  // Re-fetch when status transitions out of "Auditing" (statusNum 1 → 2/3)
  const statusNum0 = data?.[0]?.status === 'success'
    ? Number((data[0].result as any)?.status ?? (data[0].result as any)?.[6] ?? 0)
    : 0;
  useEffect(() => {
    if (statusNum0 >= 2) setSummaryFetched(false);
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

  const statusNum   = Number(get('status', 6));
  // chainlinkPending: true while project is in Auditing state (status=1)
  const chainlinkPending = statusNum === 1;

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
  const auditScore       = Number(get('auditScore',       7)  ?? 0);
  const reliabilityScore = Number(get('reliabilityScore', 8)  ?? 0);
  const qualityScore     = Number(get('qualityScore',     9)  ?? 0);
  const marketFitScore   = Number(get('marketFitScore',   10) ?? 0);
  const auditAnalysis    = parseAuditSummary(rawSummary);
  const auditFailed      = statusNum === 3 && auditScore === 0 && !auditAnalysis;

  // needsSettlement: oracle has stored result but IM is still "Auditing"
  const oracleFulfilled = fulfilledRaw?.status === 'success'
    ? BigInt(fulfilledRaw.result as bigint)
    : BigInt(0);
  const needsSettlement = statusNum === 1 && oracleFulfilled > BigInt(0);

  const fundedAmount   = BigInt(get('fundedAmount',   3) ?? 0);
  const returnedAmount = BigInt(get('returnedAmount', 16) ?? 0);

  return {
    applicant:          get('applicant',          0)  as string,
    contractAddr:       get('contractAddr',       1)  as string,
    requestedAmount:    BigInt(get('requestedAmount', 2) ?? 0),
    fundedAmount,
    returnedAmount,
    agentId:            BigInt(get('agentId',      4)  ?? 0),
    initData:           String(get('initData',     5)  ?? ''),
    statusNum,
    statusLabel:        PROJECT_STATUS[statusNum] ?? 'Unknown',
    auditScore,
    reliabilityScore,
    qualityScore,
    marketFitScore,
    auditContentHash:   String(get('auditContentHash', 15) ?? ''),
    auditAnalysis,
    auditFailed,
    submittedAt:        BigInt(get('submittedAt',        11) ?? 0),
    auditedAt:          BigInt(get('auditedAt',          12) ?? 0),
    executionUnlocksAt: BigInt(get('executionUnlocksAt', 13) ?? 0),
    settledAt:          BigInt(get('settledAt',          14) ?? 0),
    chainlinkPending,
    chainlinkRequestId: null,
    needsSettlement,
    isLoading: false,
    investmentAmount:   fundedAmount,
    releasedAmount:     returnedAmount,
    exitProceeds:       returnedAmount,
  };
}
