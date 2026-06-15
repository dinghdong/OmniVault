'use client';
import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { useAuditStatus } from '../hooks/useAuditStatus';
import {
  explorerUrl,
  investmentManagerAddress, investmentManagerAbi,
  omniOracleAddress, omniOracleAbi,
  fundVaultAddress, fundVaultAbi,
  contractChainId,
} from '../hooks/contracts';

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { color: string; icon: string; pulse?: boolean }> = {
  None:             { color: 'rgba(255,255,255,0.3)', icon: '?' },
  Auditing:         { color: '#63b3ed', icon: '🤖', pulse: true },
  PendingExecution: { color: '#a78bfa', icon: '🔒' },
  Rejected:         { color: '#f87171', icon: '✕' },
  Active:           { color: '#00ff88', icon: '✓' },
  Settled:          { color: '#8b949e', icon: '→' },
  Vetoed:           { color: '#f87171', icon: '✕' },
  CircuitBroken:    { color: '#f87171', icon: '⚠' },
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
    chainId:      contractChainId,
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

  const { writeContract: writeSetResult, data: setResultTxHash, isPending: settingResult } = useWriteContract();
  const { isLoading: setResultConfirming, isSuccess: setResultSuccess } = useWaitForTransactionReceipt({ hash: setResultTxHash });

  const [adminAction, setAdminAction] = useState<string | null>(null);
  const [simScore, setSimScore]     = useState(75);
  const [simRel, setSimRel]         = useState(80);
  const [simQual, setSimQual]       = useState(80);
  const [simMkt, setSimMkt]         = useState(70);

  function handleExecute() {
    writeExecute({
      address:      investmentManagerAddress,
      abi:          investmentManagerAbi,
      functionName: 'executeProject' as any,
      args:         [BigInt(projectId)],
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

  // Auto-finalize after setting a mock result so the demo flow stays one-click.
  useEffect(() => {
    if (setResultSuccess) {
      handleSettle();
    }
  }, [setResultSuccess]);

  function handleSetMockResult(passing: boolean) {
    const finalScore = passing ? simScore : 30;
    writeSetResult({
      address:      omniOracleAddress,
      abi:          omniOracleAbi,
      functionName: 'setResult' as any,
      args:         [
        BigInt(projectId),
        BigInt(finalScore + 1),
        passing ? simRel : 0,
        passing ? simQual : 0,
        passing ? simMkt : 0,
        `0x${'0'.repeat(64)}`,
      ],
      chainId:      contractChainId,
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

  const executionUnlocksMs = Number(status.executionUnlocksAt ?? 0) * 1000;
  const timelockActive     = status.statusNum === 2 && executionUnlocksMs > 0 && Date.now() < executionUnlocksMs;
  const timelockExpired    = status.statusNum === 2 && executionUnlocksMs > 0 && Date.now() >= executionUnlocksMs;

  const reqEth      = status.requestedAmount  > BigInt(0) ? formatEther(status.requestedAmount)  : null;
  const fundedEth   = status.fundedAmount     > BigInt(0) ? formatEther(status.fundedAmount)     : null;
  const returnedEth = status.returnedAmount   > BigInt(0) ? formatEther(status.returnedAmount)   : null;

  const auditScore      = status.auditScore;
  const reliabilityScore = status.reliabilityScore;
  const qualityScore    = status.qualityScore;
  const marketFitScore  = status.marketFitScore;
  const has3DScores     = reliabilityScore > 0 || qualityScore > 0 || marketFitScore > 0;
  const hasScore        = status.statusNum >= 3 && (auditScore > 0 || !!status.auditAnalysis || has3DScores);
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
      <div className="detail-card detail-card-padded">
        <div className="detail-section-label">
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
                <span className="asv-score-num">{auditScore}</span>
              </div>
              <div className="asv-score-info">
                <div className="asv-score-label">AI Audit Score</div>
                <div className="asv-score-rec">
                  {auditScore >= 60
                    ? <span style={{ color: '#00ff88' }}>✓ Above threshold — queued for execution</span>
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

            {/* ── 3D A2A Scores (Reliability / Quality / MarketFit) ── */}
            {has3DScores && (
              <div className="asv-round-scores">
                {[
                  { label: 'Reliability', score: reliabilityScore, weight: '40%' },
                  { label: 'Quality',     score: qualityScore,     weight: '30%' },
                  { label: 'Market Fit',  score: marketFitScore,   weight: '30%' },
                ].map(({ label, score, weight }) => (
                  <div key={label} className="asv-round-item">
                    <span className="asv-round-label" style={{ minWidth: 80 }}>
                      {label}
                      <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 3 }}>({weight})</span>
                    </span>
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
        ) : status.statusNum === 1 ? (
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

      {/* ── Dev / Simulate Audit for mock oracle ── */}
      {status.statusNum === 1 && !setResultSuccess && (
        <div className="detail-card detail-card--accent-purple">
          <div className="detail-section-label">
            <span>⚙ DEV / SIMULATE AUDIT</span>
            <span className="detail-section-line" />
          </div>
          <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
            The current oracle is a mock. For demo/testing, manually set an audit result to continue the flow.
          </div>
          <div className="asv-funding-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Final Score</span>
              <input className="input-field" type="number" min={0} max={100} value={simScore} onChange={e => setSimScore(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ maxWidth: 80 }} />
            </div>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Reliability</span>
              <input className="input-field" type="number" min={0} max={100} value={simRel} onChange={e => setSimRel(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ maxWidth: 80 }} />
            </div>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Quality</span>
              <input className="input-field" type="number" min={0} max={100} value={simQual} onChange={e => setSimQual(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ maxWidth: 80 }} />
            </div>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Market Fit</span>
              <input className="input-field" type="number" min={0} max={100} value={simMkt} onChange={e => setSimMkt(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ maxWidth: 80 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={settingResult || setResultConfirming}
              onClick={() => handleSetMockResult(true)}
            >
              {settingResult || setResultConfirming ? 'Setting…' : '✓ Simulate Passing Audit'}
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              disabled={settingResult || setResultConfirming}
              onClick={() => handleSetMockResult(false)}
            >
              ✕ Simulate Rejecting Audit
            </button>
          </div>
        </div>
      )}

      {/* ── Settle Audit (two-transaction pattern) ── */}
      {status.needsSettlement && !settleSuccess && (
        <div className="detail-card detail-card-padded detail-card--accent-yellow">
          <div className="detail-section-label">
            ⚡ Chainlink callback complete — finalization needed
          </div>
          <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
            The AI audit result is stored on-chain by the Chainlink DON.
            Click below to finalize the project status (one transaction, anyone can call).
          </div>
          <button
            className="btn-primary"
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

      {/* ── Execute Project (timelock expired, PendingExecution) ── */}
      {timelockExpired && !executeSuccess && (
        <div className="detail-card detail-card-padded detail-card--accent-green">
          <div className="detail-section-label">
            ✓ Timelock expired — ready to execute
          </div>
          <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
            LP veto window has closed. Execute to release{' '}
            {reqEth ? <strong>{reqEth} ETH</strong> : 'funds'} to the project.
          </div>
          <button
            className="btn-primary"
            onClick={handleExecute}
            disabled={executing || executeConfirming}
          >
            {executing ? 'Confirm in wallet…' : executeConfirming ? 'Executing…' : '⚡ Execute Project'}
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
          Project executed ✓ — funds released.
        </div>
      )}

      {/* ── Audit content hash (on-chain verifiable) ── */}
      {contentHashSet && (
        <div className="detail-card detail-card-padded">
          <div className="detail-section-label">Audit Fingerprint</div>
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
      {(reqEth || fundedEth) && (
        <div className="detail-card detail-card-padded">
          <div className="detail-section-label">Funding</div>
          <div className="asv-funding-grid">
            {reqEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Requested</span>
                <span className="asv-funding-val">{reqEth} ETH</span>
              </div>
            )}
            {fundedEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Funded</span>
                <span className="asv-funding-val" style={{ color: '#00ff88' }}>{fundedEth} ETH</span>
              </div>
            )}
            {returnedEth && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">Returned</span>
                <span className="asv-funding-val">{returnedEth} ETH</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Execution timelock ── */}
      {(timelockActive || timelockExpired) && (
        <div className="detail-card detail-card-padded detail-card--accent-purple">
          <div className="detail-section-label">
            🔒 Execution Timelock
          </div>
          {timelockActive ? (
            <>
              <div className="asv-countdown" style={{ color: '#a78bfa' }}>{timelockCountdown}</div>
              <div className="asv-cw-hint">
                Timelock active — <code>executeProject()</code> unlocks when it expires.
              </div>
            </>
          ) : (
            <div className="asv-cw-hint" style={{ color: '#00ff88' }}>
              ✓ Timelock expired — awaiting <code>executeProject()</code>…
            </div>
          )}
        </div>
      )}

      {/* ── LP Veto panel (during timelock) ── */}
      {timelockActive && !vetoSuccess && (
        <div className="detail-card detail-card-padded detail-card--accent-red">
          <div className="detail-section-label">🗳 LP Veto Window</div>
          {isLP ? (
            <>
              <div className="asv-ai-hint" style={{ marginBottom: 12 }}>
                You hold LP shares. You can block this execution before the timelock expires.
                Any LP may call veto — one veto is sufficient.
              </div>
              <button
                className="btn-danger"
                onClick={handleVeto}
                disabled={vetoing || vetoConfirming}
              >
                {vetoing ? 'Confirm in wallet…' : vetoConfirming ? 'Submitting…' : '🗳 Veto Execution'}
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
          Execution vetoed ✓ — no funds will be transferred.
        </div>
      )}

      {/* ── Final status messages ── */}
      {status.statusLabel === 'Active' && (
        <div className="asv-final asv-final--success">
          Project executed — funds have been released.
        </div>
      )}
      {status.statusLabel === 'Settled' && (
        <div className="asv-final asv-final--success">
          Project settled — returns recorded on-chain.
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
          {has3DScores && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.7 }}>
              Reliability: {reliabilityScore} · Quality: {qualityScore} · Market Fit: {marketFitScore}
            </span>
          )}
        </div>
      )}
      {status.statusLabel === 'Vetoed' && (
        <div className="asv-final asv-final--error">
          Execution vetoed during timelock window. No funds were transferred.
        </div>
      )}

      {/* ── Admin: circuitBreak ── */}
      {(status.statusNum === 4 || status.statusNum === 5) && (
        <div className="detail-card detail-card-padded detail-card--accent-orange">
          <div className="detail-section-label">⚙ Admin Controls</div>
          <div className="asv-ai-hint" style={{ marginBottom: 10 }}>
            Requires DEFAULT_ADMIN_ROLE — will revert if not authorized.
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn-danger btn-sm"
              onClick={handleCircuitBreak}
              disabled={adminPending || adminConfirming}
            >
              {adminPending && adminAction === 'break' ? 'Confirm…' : '⚠ Circuit Break'}
            </button>
          </div>

          {adminTxHash && adminAction === 'break' && (
            <a className="asv-tx-link" href={`${explorerUrl}/tx/${adminTxHash}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8 }}>View tx ↗</a>
          )}
          {adminSuccess && adminAction === 'break' && (
            <div className="asv-final asv-final--success" style={{ marginTop: 8 }}>Transaction confirmed ✓</div>
          )}
        </div>
      )}

      {/* ── Settled: P&L summary ── */}
      {status.statusLabel === 'Settled' && status.returnedAmount > BigInt(0) && (
        <div className="detail-card detail-card-padded">
          <div className="detail-section-label">→ Settlement Summary</div>
          <div className="asv-funding-grid">
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Funded</span>
              <span className="asv-funding-val">{formatEther(status.fundedAmount)} ETH</span>
            </div>
            <div className="asv-funding-cell">
              <span className="asv-funding-label">Returns</span>
              <span className="asv-funding-val" style={{ color: status.returnedAmount >= status.fundedAmount ? '#00ff88' : '#f87171' }}>
                {formatEther(status.returnedAmount)} ETH
              </span>
            </div>
            {status.fundedAmount > BigInt(0) && (
              <div className="asv-funding-cell">
                <span className="asv-funding-label">ROI</span>
                <span className="asv-funding-val" style={{ color: status.returnedAmount >= status.fundedAmount ? '#00ff88' : '#f87171' }}>
                  {status.returnedAmount >= status.fundedAmount ? '+' : ''}
                  {(Number(status.returnedAmount) / Number(status.fundedAmount) * 100 - 100).toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
