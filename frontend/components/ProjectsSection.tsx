'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { useProjects, ProjectData } from '../hooks/useProjects';
import { useVaultStats } from '../hooks/useVaultStats';
import { useVeto } from '../hooks/useVeto';
import {
  explorerUrl,
  investmentManagerAddress,
  investmentManagerAbi,
  contractChainId,
} from '../hooks/contracts';

// ─── NFA pixel avatar (deterministic, same as agent-sim) ─────────────────────

const AGENT_COLORS = ['#00ff88', '#63b3ed', '#a78bfa', '#f97316', '#f2cc60', '#f472b6'];

function agentColor(id: number): string {
  return AGENT_COLORS[id % AGENT_COLORS.length];
}

function AgentAvatar({ id, color, size = 20 }: { id: number; color: string; size?: number }) {
  const grid = Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) =>
      c === 2
        ? ((id * 137 + r * 31) % 7 < 4)
        : ((id * 137 + (r * 3 + c) * 31) % 7 < 4)
    )
  );
  return (
    <div style={{
      width: size, height: size,
      borderRadius: Math.round(size * 0.22),
      overflow: 'hidden',
      background: '#010409',
      border: `1px solid ${color}40`,
      flexShrink: 0,
    }}>
      <svg viewBox="0 0 3 3" width={size} height={size}>
        {grid.map((row, r) =>
          row.map((on, c) =>
            on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill={color} opacity={0.85} /> : null
          )
        )}
      </svg>
    </div>
  );
}

function AgentBadge({ agentId }: { agentId: number }) {
  if (!agentId) return null;
  const color = agentColor(agentId);
  const label = `Agent #${String(agentId).padStart(3, '0')}`;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '3px 8px 3px 4px',
      background: `${color}0d`,
      border: `1px solid ${color}25`,
      borderRadius: 6,
      marginLeft: 'auto',
    }}>
      <AgentAvatar id={agentId} color={color} size={16} />
      <span style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 9, color, opacity: 0.8, letterSpacing: '0.02em',
        maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '—';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function fmtEth(wei: bigint) {
  const e = parseFloat(formatUnits(wei, 18));
  return e === 0 ? '0' : e.toFixed(4);
}

function useCountdown(endTimestamp: bigint) {
  const end = Number(endTimestamp) * 1000;
  const [remaining, setRemaining] = useState(Math.max(0, end - Date.now()));

  useEffect(() => {
    if (end === 0) return;
    const iv = setInterval(() => setRemaining(Math.max(0, end - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [end]);

  if (end === 0 || remaining === 0) return null;
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

// ─── Status badge ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  None:             'badge-gray',
  Auditing:         'badge-blue',
  PendingExecution: 'badge-purple',
  Rejected:         'badge-red',
  Active:           'badge-green',
  Settled:          'badge-gray',
  Vetoed:           'badge-red',
  CircuitBroken:    'badge-red',
};

function StatusBadge({ label }: { label: string }) {
  const cls = STATUS_COLORS[label] || 'badge-gray';
  return <span className={`proj-badge ${cls}`}>{label}</span>;
}

// ─── Single project card ───────────────────────────────────────────────────

interface ProjectCardProps {
  project: ProjectData;
  onViewAudit: (id: number) => void;
}

function ProjectCard({ project, onViewAudit }: ProjectCardProps) {
  const { address } = useAccount();
  const { veto, isPending, isConfirming, isConfirmed, error } = useVeto();
  const {
    writeContract: executeProject,
    data: execHash,
    isPending: execPending,
    error: execError,
  } = useWriteContract();
  const { isLoading: execConfirming, isSuccess: execSuccess } =
    useWaitForTransactionReceipt({ hash: execHash });
  const execBusy = execPending || execConfirming;

  const timelockCountdown = useCountdown(project.executionUnlocksAt ?? BigInt(0));

  const isSettled = project.statusNum === 5;
  const isActive = project.statusNum === 4;

  // Execution timelock: PendingExecution (2) counting down to executeProject()
  const executionUnlocksMs = Number(project.executionUnlocksAt ?? 0) * 1000;
  const timelockActive  = project.statusNum === 2 && executionUnlocksMs > 0 && Date.now() < executionUnlocksMs;
  const timelockExpired = project.statusNum === 2 && executionUnlocksMs > 0 && Date.now() >= executionUnlocksMs;

  // Show veto button during PendingExecution timelock window for any connected LP
  const showVeto = timelockActive && !!address;

  // Audit content hash set on-chain
  const contentHashSet =
    project.auditContentHash &&
    project.auditContentHash !== '0x' + '0'.repeat(64);

  // auditScore is stored as 0-100 integer on chain
  const auditScore = Number(project.auditScore ?? 0);

  return (
    <div className="project-card">
      <div className="project-card-header">
        <div className="project-id">#{project.projectId}</div>
        <StatusBadge label={project.statusLabel} />
        {project.auditedAt > 0n && auditScore > 0 && (
          <span className="proj-score">Score: {auditScore}%</span>
        )}
        {Number(project.agentId) > 0 && <AgentBadge agentId={Number(project.agentId)} />}
      </div>

      <div className="project-meta">
        <div className="project-meta-row">
          <span className="meta-label">Applicant</span>
          <a
            className="meta-value meta-link"
            href={`${explorerUrl}/address/${project.applicant}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortAddr(project.applicant)}
          </a>
        </div>
        {project.requestedAmount > 0n && (
          <div className="project-meta-row">
            <span className="meta-label">Requested</span>
            <span className="meta-value">{fmtEth(project.requestedAmount)} ETH</span>
          </div>
        )}
        {(isActive || isSettled) && project.fundedAmount > 0n && (
          <div className="project-meta-row">
            <span className="meta-label">{isSettled ? 'Funded' : 'Funded'}</span>
            <span className="meta-value">{fmtEth(project.fundedAmount)} ETH</span>
          </div>
        )}
        {isSettled && project.returnedAmount > 0n && (
          <div className="project-meta-row">
            <span className="meta-label">Returned</span>
            <span className="meta-value">{fmtEth(project.returnedAmount)} ETH</span>
          </div>
        )}
        {/* 3D score breakdown if audited */}
        {project.auditedAt > 0n && project.reliabilityScore > 0 && (
          <div className="project-meta-row">
            <span className="meta-label">3D Scores</span>
            <span className="meta-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              R:{project.reliabilityScore} Q:{project.qualityScore} M:{project.marketFitScore}
            </span>
          </div>
        )}
      </div>

      {/* Execution timelock countdown */}
      {(timelockActive || timelockExpired) && (
        <div className="community-window" style={{ borderColor: 'rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.05)' }}>
          <div className="cw-label" style={{ color: '#a78bfa' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              <rect x="3" y="6" width="8" height="6" rx="1" stroke="#a78bfa" strokeWidth="1.2"/>
              <path d="M5 6V4a2 2 0 014 0v2" stroke="#a78bfa" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Execution Timelock
          </div>
          {timelockActive ? (
            <>
              <div className="cw-countdown" style={{ color: '#a78bfa' }}>{timelockCountdown}</div>
              <div className="cw-hint">48h LP veto window — any LP can veto before funds are released.</div>
            </>
          ) : (
            <div className="cw-hint" style={{ color: '#00ff88' }}>
              ✓ Timelock expired — awaiting executeProject()…
            </div>
          )}
        </div>
      )}

      {/* Execute button once timelock expires */}
      {timelockExpired && !execSuccess && (
        <div className="community-window" style={{ borderColor: 'rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.05)' }}>
          <div className="cw-label" style={{ color: '#00ff88' }}>Ready to Execute</div>
          <div className="cw-hint">LP veto window has closed. Execute the project to release funds.</div>
          <button
            className="btn-primary"
            style={{ marginTop: 10 }}
            disabled={execBusy}
            onClick={() => executeProject({
              address: investmentManagerAddress,
              abi: investmentManagerAbi,
              functionName: 'executeProject',
              args: [BigInt(project.projectId)],
              chainId: contractChainId,
            } as any)}
          >
            {execBusy ? 'Executing…' : 'Execute Project'}
          </button>
          {execError && <div className="proj-tx-error" style={{ marginTop: 8 }}>{(execError as Error).message?.slice(0, 80)}</div>}
        </div>
      )}
      {execSuccess && <div className="proj-tx-success">Project executed ✓</div>}

      {/* Audit content hash (on-chain verifiable) */}
      {contentHashSet && (
        <div className="zg-proof">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <path d="M7 1L1 4v3c0 3.31 2.67 6.41 6 7 3.33-.59 6-3.69 6-7V4L7 1z" stroke="#00ff88" strokeWidth="1.2" fill="none"/>
            <path d="M4.5 7l1.5 1.5L9.5 5" stroke="#00ff88" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="zg-label">Audit fingerprint</span>
          <code className="zg-hash">{project.auditContentHash.slice(0, 10)}…</code>
        </div>
      )}

      {/* Action buttons */}
      <div className="project-actions">
        {showVeto && (
          <button
            className="btn-veto"
            onClick={() => veto(project.projectId)}
            disabled={isPending || isConfirming}
          >
            {isPending || isConfirming ? 'Submitting…' : '⚠ Veto Investment'}
          </button>
        )}
        <button
          className="btn-explorer"
          onClick={() => onViewAudit(project.projectId)}
        >
          View Audit →
        </button>
        <a
          className="btn-explorer"
          href={`${explorerUrl}/address/${project.applicant}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Explorer ↗
        </a>
      </div>

      {isConfirmed && (
        <div className="proj-tx-success">Transaction confirmed ✓</div>
      )}
      {error && (
        <div className="proj-tx-error">{(error as Error).message?.slice(0, 80)}</div>
      )}
    </div>
  );
}

// ─── Main section ──────────────────────────────────────────────────────────

export default function ProjectsSection() {
  const { projectCount, isLoading: statsLoading } = useVaultStats();
  const { projects, isLoading: projLoading } = useProjects(projectCount);
  const router = useRouter();

  const isLoading = statsLoading || projLoading;

  const SubmitCTA = () => (
    <a
      href="/agent-sim"
      className="submit-project-cta"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '18px 24px',
        marginBottom: 28,
        background: 'rgba(0,255,136,0.04)',
        border: '1px dashed rgba(0,255,136,0.3)',
        borderRadius: 12,
        textDecoration: 'none',
        transition: 'all 0.2s',
      }}
    >
      <div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
          fontWeight: 600,
          color: '#00ff88',
          marginBottom: 4,
          letterSpacing: '0.02em',
        }}>
          Submit Project
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'rgba(255,255,255,0.4)',
        }}>
          Mint an NFA identity and apply for funding
        </div>
      </div>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        color: '#00ff88',
        whiteSpace: 'nowrap',
      }}>
        Get Started →
      </span>
    </a>
  );

  if (!isLoading && projectCount === 0) {
    return (
      <section className="projects-section" id="pipeline">
        <div className="section-header centered">
          <h2 className="section-title">AI Audit Pipeline</h2>
          <p className="section-subtitle">No projects submitted yet — be the first to apply</p>
        </div>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SubmitCTA />
        </div>
      </section>
    );
  }

  return (
    <section className="projects-section" id="pipeline">
      <div className="section-header centered">
        <h2 className="section-title">AI Audit Pipeline</h2>
        <p className="section-subtitle">
          {isLoading
            ? 'Loading projects…'
            : `${projectCount} project${projectCount !== 1 ? 's' : ''} in the pipeline`}
        </p>
      </div>

      {isLoading ? (
        <div className="proj-loading">
          <div className="proj-spinner" />
        </div>
      ) : (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SubmitCTA />
          <div className="projects-grid">
            {[...projects].reverse().map((p) => (
              <ProjectCard
                key={p.projectId}
                project={p}
                onViewAudit={(id) => router.push(`/audit/${id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
