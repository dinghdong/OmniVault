'use client';
import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { useAuditStatus } from '../hooks/useAuditStatus';
import {
  explorerUrl,
  investmentManagerAddress, investmentManagerAbi,
  fundVaultAddress, fundVaultAbi,
} from '../hooks/contracts';

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { color: string; icon: string; pulse?: boolean }> = {
  Pending:          { color: '#facc15', icon: '⏳', pulse: true },
  Auditing:         { color: '#63b3ed', icon: '🤖', pulse: true },
  PendingExecution: { color: '#a78bfa', icon: '🔒' },
  Rejected:         { color: '#f87171', icon: '✕' },
  Active:           { color: '#00ff88', icon: '✓' },
  CircuitBroken:    { color: '#f87171', icon: '⚠' },
  Exited:           { color: 'rgba(255,255,255,0.4)', icon: '→' },
  WriteOff:         { color: '#f87171', icon: '✕' },
  Vetoed:           { color: '#f87171', icon: '✕' },
  None:             { color: 'rgba(255,255,255,0.3)', icon: '?' },
};

function useCountdown(endTimestamp: bigint | undefined) {
  const end = Number(endTimestamp ?? 0) * 1000;
  const [rem, setRem] = useState(Math.max(0, end - Date.now()));
  useEffect(() => {
    if (!end) return;
    const iv = setInterval(() => setRem(Math.max(0, end - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [end]);
  if (!end || rem === 0) return null;
  const h = Math.floor(rem / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}


// ─── Agent report panel ───────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  pitchDeckAnalysis: 'Pitch Deck Analysis',
  riskAssessment:    'Risk Assessment',
  businessAnalysis:  'Business Analysis',
};

const SCORE_DIMS: Record<string, string> = {
  problem_solution:   'Problem / Solution',
  market_opportunity: 'Market Opportunity',
  team_execution:     'Team & Execution',
  traction:           'Traction',
  tokenomics:         'Tokenomics',
  web3_rationale:     'Web3 Rationale',
};

// ─── Main component ───────────────────────────────────────────────────────────

// (AgentCard / AgentReportPanel / ComputeProofPanel removed — audit data now comes directly
//  from InvestmentManager on-chain, fulfilled by Chainlink Functions × 0G Compute)

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  projectId: number;
  txHash:    string | undefined;
  chainId:   number;
  onDone:    () => void;
}

export default function AuditStatusView({ projectId, txHash, chainId, onDone }: Props) {
  const status            = useAuditStatus(projectId);
  const timelockCountdown = useCountdown(status.executionUnlocksAt);
  const meta              = STATUS_META[status.statusLabel] ?? STATUS_META.None;
  const { address }       = useAccount();

  // LP balance — determines veto eligibility
  const { data: lpBalance } = useReadContract({
    address:      fundVaultAddress,
    abi:          fundVaultAbi,
    functionName: 'balanceOf',
    args:         address ? [address] : undefined,
    query:        { enabled: !!address },
  } as any);
  const isLP = lpBalance !== undefined && (lpBalance as bigint) > BigInt(0);

  const { writeContract: writeVeto, data: vetoTxHash, isPending: vetoing } = useWriteContract();
  const { isLoading: vetoConfirming, isSuccess: vetoSuccess } = useWaitForTransactionReceipt({ hash: vetoTxHash });

  function handleVeto() {
    writeVeto({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'veto' as any,
      args:         [BigInt(projectId)],
    } as any);
  }

  const { writeContract, data: settleTxHash, isPending: settling } = useWriteContract();
  const { isLoading: settleConfirming, isSuccess: settleSuccess } = useWaitForTransactionReceipt({ hash: settleTxHash });

  const { writeContract: writeExecute, data: executeTxHash, isPending: executing } = useWriteContract();
  const { isLoading: executeConfirming, isSuccess: executeSuccess } = useWaitForTransactionReceipt({ hash: executeTxHash });

  const { writeContract: writeAdmin, data: adminTxHash, isPending: adminPending } = useWriteContract();
  const { isLoading: adminConfirming, isSuccess: adminSuccess } = useWaitForTransactionReceipt({ hash: adminTxHash });

  const [exitReturnPct, setExitReturnPct] = useState(150);
  const [adminAction, setAdminAction] = useState<string | null>(null);

  // Vesting progress — only fetch when Active
  const { data: vestingRaw } = useReadContract({
    address:      investmentManagerAddress,
    abi:          investmentManagerAbi,
    functionName: 'vestingProgress' as any,
    args:         [BigInt(projectId)] as any,
    query:        { enabled: status.statusNum === 5, refetchInterval: 10_000 },
  } as any);
  const vestingData  = vestingRaw as [bigint, bigint, bigint, bigint] | undefined;
  const vestedBps    = vestingData ? Number(vestingData[0]) : 0;
  const claimableWei = vestingData ? vestingData[1] : BigInt(0);
  const releasedWei  = vestingData ? vestingData[2] : BigInt(0);
  const vestTotal    = vestingData ? vestingData[3] : BigInt(0);

  function handleExecute() {
    writeExecute({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'executeInvestment' as any,
      args:         [BigInt(projectId), status.requestedAmount, '0x' as `0x${string}`],
    } as any);
  }

  function handleSettle() {
    writeContract({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'settleAudit' as any,
      args:         [BigInt(projectId)],
    } as any);
  }

  function handleClaim() {
    setAdminAction('claim');
    writeAdmin({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'claimPayout' as any,
      args:         [BigInt(projectId)],
    } as any);
  }

  function handleSimulateExit() {
    setAdminAction('exit');
    writeAdmin({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'simulateExit' as any,
      args:         [BigInt(projectId), BigInt(Math.round(exitReturnPct * 100))],
    } as any);
  }

  function handleCircuitBreak() {
    setAdminAction('break');
    writeAdmin({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'triggerCircuitBreak' as any,
      args:         [BigInt(projectId)],
    } as any);
  }

  function handleWriteOff() {
    setAdminAction('writeoff');
    writeAdmin({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'markWriteOff' as any,
      args:         [BigInt(projectId)],
    } as any);
  }

  const executionUnlocksMs = Number(status.executionUnlocksAt ?? 0) * 1000;
  const timelockActive     = status.statusNum === 3 && executionUnlocksMs > 0 && Date.now() < executionUnlocksMs;
  const timelockExpired    = status.statusNum === 3 && executionUnlocksMs > 0 && Date.now() >= executionUnlocksMs;

  const reqEth      = status.requestedAmount  > BigInt(0) ? formatEther(status.requestedAmount)  : null;
  const investedEth = status.investmentAmount > BigInt(0) ? formatEther(status.investmentAmount) : null;
  const releasedEth = status.releasedAmount   > BigInt(0) ? formatEther(status.releasedAmount)   : null;

  const auditScore    = Number(status.auditScore ?? 0);
  const hasScore      = status.statusNum >= 3 && (auditScore > 0 || !!status.auditAnalysis);
  const contentHashSet =
    status.auditContentHash &&
    status.auditContentHash !== '0x' + '0'.repeat(64);
  const analysis      = status.auditAnalysis;

  return (
    <div className="asv-root">

      {/* ── Header ── */}
      <div className="asv-header">
        <div className="asv-badge">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8l4 4 8-8" stroke="#00ff88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Submitted — Project #{projectId}
        </div>
        {txHash && (
          <a className="asv-tx-link" href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
            View tx ↗
          </a>
        )}
      </div>

      {/* ── On-chain status ── */}
      <div className="asv-status-row">
        <span className="asv-status-label">On-chain status</span>
        <span className="asv-status-badge" style={{ color: meta.color }}>
          {meta.pulse && <span className="asv-pulse-dot" style={{ background: meta.color }} />}
          {meta.icon} {status.statusLabel}
        </span>
      </div>

      {/* ── Chainlink Functions / 0G Compute status ── */}
      <div className="asv-section">
        <div className="asv-section-title">
          AI Audit — Chainlink × 0G Compute
          {status.chainlinkPending && <span className="asv-running-pill">Running…</span>}
          {hasScore && <span className="asv-done-pill">Done</span>}
        </div>

        {status.isLoading ? (
          <div className="asv-loading-row">
            <div className="asv-spinner-sm" />
            <span>Fetching chain data…</span>
          </div>
        ) : status.chainlinkPending ? (
          <>
            <div className="asv-ai-progress">
              <div className="asv-ai-bar"><div className="asv-ai-bar-fill" /></div>
              <span className="asv-ai-hint">
                Chainlink DON calling 0G Compute (3 rounds) — takes ~15–30 s
              </span>
            </div>
            {status.chainlinkRequestId && (
              <div className="asv-zg-row" style={{ marginTop: 8 }}>
                <span style={{ opacity: 0.5, fontSize: 11 }}>CL request</span>
                <code className="asv-hash">{status.chainlinkRequestId.slice(0, 14)}…</code>
              </div>
            )}
          </>
        ) : hasScore ? (
          <>
            <div className="asv-score-row">
              <div className="asv-score-circle" style={{
                background: `conic-gradient(${auditScore >= 60 ? '#00ff88' : '#f87171'} ${auditScore * 3.6}deg, rgba(255,255,255,0.06) 0deg)`,
              }}>
                <span className="asv-score-num">{auditScore || (analysis?.scores?.[3] ?? 0)}</span>
              </div>
              <div className="asv-score-info">
                <div className="asv-score-label">AI Audit Score</div>
                <div className="asv-score-rec">
                  {(auditScore || (analysis?.scores?.[3] ?? 0)) >= 60
                    ? <span style={{ color: '#00ff88' }}>✓ Above threshold — queued for investment</span>
                    : <span style={{ color: '#f87171' }}>✕ Below threshold — application rejected</span>
                  }
                </div>
                {analysis?.recommendation && (
                  <div className="asv-score-rec" style={{ marginTop: 4 }}>
                    <span style={{ color: analysis.recommendation === 'APPROVE' ? '#00ff88' : '#f87171', fontWeight: 600 }}>
                      {analysis.recommendation}
                    </span>
                  </div>
                )}
                <div className="asv-agents-used" style={{ marginTop: 8 }}>
                  <span className="asv-agent-chip">Chainlink Functions DON</span>
                  <span className="asv-agent-chip">0G Compute TeeML</span>
                </div>
              </div>
            </div>

            {/* ── Round scores ── */}
            {analysis && analysis.scores.length >= 4 && (
              <div className="asv-round-scores">
                {[
                  { label: 'Security', score: analysis.scores[0] },
                  { label: 'Risk',     score: analysis.scores[1] },
                  { label: 'Final',    score: analysis.scores[2] },
                ].map(({ label, score }) => (
                  <div key={label} className="asv-round-item">
                    <span className="asv-round-label">{label}</span>
                    <div className="asv-round-bar">
                      <div className="asv-round-bar-fill" style={{
                        width: `${score}%`,
                        background: score >= 60 ? '#00ff88' : score >= 40 ? '#facc15' : '#f87171',
                      }} />
                    </div>
                    <span className="asv-round-score">{score}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Rationale ── */}
            {analysis?.rationale && (
              <div className="asv-rationale">
                <span className="asv-rationale-icon">💬</span>
                <span>{analysis.rationale}</span>
              </div>
            )}

            {/* ── Findings & Risks ── */}
            {(analysis?.findings?.length || analysis?.risks?.length) ? (
              <div className="asv-findings">
                {analysis.findings?.length > 0 && (
                  <div className="asv-findings-group">
                    <div className="asv-findings-title">Security Findings</div>
                    {analysis.findings.map((f, i) => (
                      <div key={i} className="asv-finding-item">
                        <span style={{ color: '#facc15' }}>⚠</span> {f}
                      </div>
                    ))}
                  </div>
                )}
                {analysis.risks?.length > 0 && (
                  <div className="asv-findings-group">
                    <div className="asv-findings-title">Risk Factors</div>
                    {analysis.risks.map((r, i) => (
                      <div key={i} className="asv-finding-item">
                        <span style={{ color: '#f87171' }}>✕</span> {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : status.statusNum === 2 ? (
          <div className="asv-loading-row">
            <div className="asv-spinner-sm" />
            <span>Waiting for Chainlink Functions request…</span>
          </div>
        ) : (
          <div className="asv-loading-row" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              <path d="M2 7l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Audit complete</span>
          </div>
        )}
      </div>

      {/* ── Settle Audit (two-transaction pattern) ── */}
      {status.needsSettlement && !settleSuccess && (
        <div className="asv-section asv-settle-banner">
          <div className="asv-section-title" style={{ color: '#facc15' }}>
            ⚡ Chainlink callback complete — finalization needed
          </div>
          <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
            The AI audit result is stored on-chain by the Chainlink DON.
            Click below to finalize the project status (one transaction, anyone can call).
          </div>
          <button
            className="asv-settle-btn"
            onClick={handleSettle}
            disabled={settling || settleConfirming}
          >
            {settling ? 'Confirm in wallet…' : settleConfirming ? 'Finalizing…' : '⚡ Finalize Audit Result'}
          </button>
          {settleTxHash && (
            <a className="asv-tx-link" href={`${explorerUrl}/tx/${settleTxHash}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>
              View tx ↗
            </a>
          )}
        </div>
      )}

      {/* ── Execute Investment (timelock expired, PendingExecution) ── */}
      {timelockExpired && !executeSuccess && (
        <div className="asv-section asv-settle-banner" style={{ borderColor: 'rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.05)' }}>
          <div className="asv-section-title" style={{ color: '#00ff88' }}>
            ✓ Timelock expired — ready to execute
          </div>
          <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
            LP veto window has closed. Execute to release{' '}
            {reqEth ? <strong>{reqEth} ETH</strong> : 'funds'} to the project (20% upfront, 80% vested over 52 weeks).
          </div>
          <button
            className="asv-settle-btn"
            onClick={handleExecute}
            disabled={executing || executeConfirming}
            style={{ borderColor: '#00ff88', color: '#00ff88' }}
          >
            {executing ? 'Confirm in wallet…' : executeConfirming ? 'Executing…' : '⚡ Execute Investment'}
          </button>
          {executeTxHash && (
            <a className="asv-tx-link" href={`${explorerUrl}/tx/${executeTxHash}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>
              View tx ↗
            </a>
          )}
        </div>
      )}
      {executeSuccess && (
        <div className="asv-final asv-final--success">
          Investment executed ✓ — project is now Active. Vesting clock started.
        </div>
      )}

      {/* ── Audit content hash (on-chain verifiable) ── */}
      {contentHashSet && (
        <div className="asv-section">
          <div className="asv-section-title">Audit Fingerprint</div>
          <div className="asv-zg-row">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L1 4v3c0 3.31 2.67 6.41 6 7 3.33-.59 6-3.69 6-7V4L7 1z" stroke="#00ff88" strokeWidth="1.2"/>
              <path d="M4.5 7l1.5 1.5L9.5 5" stroke="#00ff88" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>SHA-256 of 3-round debate log committed on-chain</span>
            <code className="asv-hash">{status.auditContentHash.slice(0, 14)}…</code>
          </div>
          <div className="asv-ai-hint" style={{ marginTop: 6 }}>
            Recompute from raw inference logs to verify — hash cannot be forged.
          </div>
        </div>
      )}

      {/* ── Funding info ── */}
      {(reqEth || investedEth) && (
        <div className="asv-section">
          <div className="asv-section-title">Funding</div>
          <div className="asv-funding-grid">
            {reqEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Requested</span>
                <span className="asv-funding-val">{reqEth} ETH</span>
              </div>
            )}
            {investedEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Invested</span>
                <span className="asv-funding-val" style={{ color: '#00ff88' }}>{investedEth} ETH</span>
              </div>
            )}
            {releasedEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Released</span>
                <span className="asv-funding-val">{releasedEth} ETH</span>
              </div>
            )}
            {investedEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Vesting</span>
                <span className="asv-funding-val">20% up · 80% / 52w</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Execution timelock ── */}
      {(timelockActive || timelockExpired) && (
        <div className="asv-section asv-timelock">
          <div className="asv-section-title" style={{ color: '#a78bfa' }}>
            🔒 Execution Timelock
          </div>
          {timelockActive ? (
            <>
              <div className="asv-countdown" style={{ color: '#a78bfa' }}>{timelockCountdown}</div>
              <div className="asv-cw-hint">
                Timelock active — <code>executeInvestment()</code> unlocks when it expires.
              </div>
            </>
          ) : (
            <div className="asv-cw-hint" style={{ color: '#00ff88' }}>
              ✓ Timelock expired — awaiting <code>executeInvestment()</code>…
            </div>
          )}
        </div>
      )}

      {/* ── LP Veto panel (during timelock) ── */}
      {timelockActive && !vetoSuccess && (
        <div className="asv-section" style={{ borderColor: 'rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.04)' }}>
          <div className="asv-section-title" style={{ color: '#f87171' }}>🗳 LP Veto Window</div>
          {isLP ? (
            <>
              <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
                You hold LP shares. You can block this investment before the timelock expires.
                Any LP may call veto — one veto is sufficient.
              </div>
              <button
                className="asv-settle-btn"
                onClick={handleVeto}
                disabled={vetoing || vetoConfirming}
                style={{ borderColor: '#f87171', color: '#f87171' }}
              >
                {vetoing ? 'Confirm in wallet…' : vetoConfirming ? 'Submitting…' : '🗳 Veto Investment'}
              </button>
              {vetoTxHash && (
                <a className="asv-tx-link" href={`${explorerUrl}/tx/${vetoTxHash}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>
                  View tx ↗
                </a>
              )}
            </>
          ) : (
            <div className="asv-ai-hint">
              {address
                ? 'You have no LP shares — deposit ETH into the vault to gain veto rights.'
                : 'Connect your wallet to check LP veto eligibility.'}
            </div>
          )}
        </div>
      )}
      {vetoSuccess && (
        <div className="asv-final asv-final--error">
          Investment vetoed ✓ — no funds will be transferred.
        </div>
      )}

      {/* ── Final status messages ── */}
      {status.statusLabel === 'Active' && (
        <div className="asv-final asv-final--success">
          Investment executed — project is now active in the portfolio.
        </div>
      )}
      {status.statusLabel === 'Rejected' && status.auditFailed && (
        <div className="asv-final asv-final--error">
          AI audit execution failed (Chainlink DON error). No funds were transferred. You may resubmit.
        </div>
      )}
      {status.statusLabel === 'Rejected' && !status.auditFailed && (
        <div className="asv-final asv-final--error">
          AI audit score below threshold ({auditScore}/100 &lt; 60). No funds were transferred.
        </div>
      )}
      {status.statusLabel === 'Vetoed' && (
        <div className="asv-final asv-final--error">
          Investment vetoed during timelock window. No funds were transferred.
        </div>
      )}

      {/* ── Active: Vesting & Claim ── */}
      {status.statusNum === 5 && vestingData && (
        <div className="asv-section" style={{ borderColor: 'rgba(0,255,136,0.2)' }}>
          <div className="asv-section-title" style={{ color: '#00ff88' }}>⚡ Vesting Schedule</div>
          <div className="asv-round-scores" style={{ marginBottom: 12 }}>
            <div className="asv-round-item">
              <span className="asv-round-label">Vested</span>
              <div className="asv-round-bar">
                <div className="asv-round-bar-fill" style={{ width: `${vestedBps / 100}%`, background: '#00ff88' }} />
              </div>
              <span className="asv-round-score">{(vestedBps / 100).toFixed(1)}%</span>
            </div>
          </div>
          <div className="asv-funding-grid">
            {vestTotal > BigInt(0) && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Total Invested</span>
                <span className="asv-funding-val">{formatEther(vestTotal)} ETH</span>
              </div>
            )}
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Released</span>
              <span className="asv-funding-val">{releasedWei > BigInt(0) ? formatEther(releasedWei) : '0'} ETH</span>
            </div>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Claimable Now</span>
              <span className="asv-funding-val" style={{ color: claimableWei > BigInt(0) ? '#00ff88' : undefined }}>
                {claimableWei > BigInt(0) ? formatEther(claimableWei) : '0'} ETH
              </span>
            </div>
          </div>
          {claimableWei > BigInt(0) && !(adminSuccess && adminAction === 'claim') && (
            <button
              className="asv-settle-btn"
              onClick={handleClaim}
              disabled={adminPending || adminConfirming}
              style={{ marginTop: 12, borderColor: '#00ff88', color: '#00ff88' }}
            >
              {adminPending && adminAction === 'claim' ? 'Confirm in wallet…'
                : adminConfirming && adminAction === 'claim' ? 'Claiming…'
                : '⚡ Claim Payout'}
            </button>
          )}
          {adminSuccess && adminAction === 'claim' && (
            <div className="asv-final asv-final--success" style={{ marginTop: 8 }}>Payout claimed ✓</div>
          )}
          {adminTxHash && adminAction === 'claim' && (
            <a className="asv-tx-link" href={`${explorerUrl}/tx/${adminTxHash}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>View tx ↗</a>
          )}
        </div>
      )}

      {/* ── Admin: simulateExit / circuitBreak / writeOff ── */}
      {(status.statusNum === 5 || status.statusNum === 6) && (
        <div className="asv-section" style={{ borderColor: 'rgba(249,115,22,0.2)', background: 'rgba(249,115,22,0.03)' }}>
          <div className="asv-section-title" style={{ color: '#f97316' }}>⚙ Admin Controls</div>
          <div className="asv-ai-hint" style={{ marginBottom: 10 }}>
            Requires RISK_AGENT_ROLE / DEFAULT_ADMIN_ROLE — will revert if not authorized.
          </div>

          {status.statusNum === 5 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, whiteSpace: 'nowrap' }}>Return %</label>
                <input
                  type="number"
                  value={exitReturnPct}
                  onChange={e => setExitReturnPct(Number(e.target.value))}
                  min={0}
                  max={10000}
                  style={{
                    width: 70, padding: '3px 6px',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(249,115,22,0.3)',
                    borderRadius: 4, color: '#fff', fontSize: 12,
                  }}
                />
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                  100=1x · {exitReturnPct}% = {exitReturnPct >= 100 ? '+' : ''}{(exitReturnPct - 100).toFixed(0)}% ROI
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="asv-settle-btn"
                  onClick={handleSimulateExit}
                  disabled={adminPending || adminConfirming}
                  style={{ borderColor: '#f97316', color: '#f97316', fontSize: 12, padding: '6px 12px' }}
                >
                  {adminPending && adminAction === 'exit' ? 'Confirm…' : '→ Simulate Exit'}
                </button>
                <button
                  className="asv-settle-btn"
                  onClick={handleCircuitBreak}
                  disabled={adminPending || adminConfirming}
                  style={{ borderColor: '#f87171', color: '#f87171', fontSize: 12, padding: '6px 12px' }}
                >
                  {adminPending && adminAction === 'break' ? 'Confirm…' : '⚠ Circuit Break'}
                </button>
              </div>
            </>
          )}

          {status.statusNum === 6 && (
            <button
              className="asv-settle-btn"
              onClick={handleWriteOff}
              disabled={adminPending || adminConfirming}
              style={{ borderColor: '#f87171', color: '#f87171', fontSize: 12, padding: '6px 12px' }}
            >
              {adminPending && adminAction === 'writeoff' ? 'Confirm…' : '✕ Mark Write-Off'}
            </button>
          )}

          {adminTxHash && adminAction !== 'claim' && (
            <a className="asv-tx-link" href={`${explorerUrl}/tx/${adminTxHash}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>View tx ↗</a>
          )}
          {adminSuccess && adminAction !== 'claim' && (
            <div className="asv-final asv-final--success" style={{ marginTop: 8 }}>Transaction confirmed ✓</div>
          )}
        </div>
      )}

      {/* ── Exited: P&L summary ── */}
      {status.statusNum === 7 && status.exitProceeds > BigInt(0) && (
        <div className="asv-section" style={{ borderColor: 'rgba(139,148,158,0.25)' }}>
          <div className="asv-section-title" style={{ color: '#8b949e' }}>→ Exit Summary</div>
          <div className="asv-funding-grid">
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Invested</span>
              <span className="asv-funding-val">{formatEther(status.investmentAmount)} ETH</span>
            </div>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Returns</span>
              <span className="asv-funding-val" style={{ color: status.exitProceeds >= status.investmentAmount ? '#00ff88' : '#f87171' }}>
                {formatEther(status.exitProceeds)} ETH
              </span>
            </div>
            {status.investmentAmount > BigInt(0) && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">ROI</span>
                <span className="asv-funding-val" style={{ color: status.exitProceeds >= status.investmentAmount ? '#00ff88' : '#f87171' }}>
                  {status.exitProceeds >= status.investmentAmount ? '+' : ''}
                  {(Number(status.exitProceeds) / Number(status.investmentAmount) * 100 - 100).toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
