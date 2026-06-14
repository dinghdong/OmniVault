'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { useProjects, ProjectData } from '../hooks/useProjects';
import { useVaultStats } from '../hooks/useVaultStats';
import { useVeto } from '../hooks/useVeto';
import { useClaimPayout } from '../hooks/useClaimPayout';
import { explorerUrl } from '../hooks/contracts';

// ─── NFA pixel avatar (deterministic, same as agent-sim) ─────────────────────

const AGENT_COLORS = ['#00ff88', '#63b3ed', '#a78bfa', '#f97316', '#f2cc60', '#f472b6'];

function didColor(did: string): string {
  let h = 0;
  for (let i = 0; i < did.length; i++) h = (h * 31 + did.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}

function agentIdFromDid(did: string): number {
  const m = did.match(/:(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
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

function AgentBadge({ did }: { did: string }) {
  if (!did || !did.startsWith('did:')) return null;
  const color   = didColor(did);
  const agentId = agentIdFromDid(did);
  const abbrev  = did.length > 28 ? `${did.slice(0, 16)}…${did.slice(-6)}` : did;
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
      }}>{abbrev}</span>
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
  Pending:          'badge-yellow',
  Auditing:         'badge-blue',
  PendingExecution: 'badge-purple',
  Rejected:         'badge-red',
  Active:           'badge-green',
  CircuitBroken:    'badge-red',
  Exited:           'badge-gray',
  WriteOff:         'badge-red',
  Vetoed:           'badge-red',
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
  const timelockCountdown = useCountdown(project.executionUnlocksAt ?? BigInt(0));

  // Vesting / claim — only active for the applicant when project is Active
  const isApplicant = !!address && !!project.applicant &&
    address.toLowerCase() === project.applicant.toLowerCase();
  const isActive = project.statusNum === 5; // Active
  const {
    vestedBps, claimable, released, total,
    claim, isPending: claimPending, isConfirming: claimConfirming,
    isConfirmed: claimConfirmed, error: claimError,
  } = useClaimPayout(project.projectId, isApplicant && isActive);

  // Execution timelock: IM moved to PendingExecution, counting down to executeInvestment
  const executionUnlocksMs = Number(project.executionUnlocksAt ?? 0) * 1000;
  const timelockActive  = project.statusNum === 3 && executionUnlocksMs > 0 && Date.now() < executionUnlocksMs;
  const timelockExpired = project.statusNum === 3 && executionUnlocksMs > 0 && Date.now() >= executionUnlocksMs;

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
        {project.agentDid && <AgentBadge did={project.agentDid} />}
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
        {project.bizApi && (
          <div className="project-meta-row">
            <span className="meta-label">Project URL</span>
            <span className="meta-value meta-truncate">{project.bizApi}</span>
          </div>
        )}
        {project.investmentAmount > 0 && (
          <div className="project-meta-row">
            <span className="meta-label">Investment</span>
            <span className="meta-value">{fmtEth(project.investmentAmount)} ETH</span>
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
              ✓ Timelock expired — awaiting executeInvestment()…
            </div>
          )}
        </div>
      )}

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

      {/* Vesting / claim panel — visible only to the applicant on Active projects */}
      {isApplicant && isActive && total > BigInt(0) && (
        <div className="vesting-panel">
          <div className="vesting-header">
            <span className="vesting-title">Vesting Schedule</span>
            <span className="vesting-pct">{(Number(vestedBps) / 100).toFixed(1)}% vested</span>
          </div>
          <div className="vesting-bar-track">
            <div
              className="vesting-bar-fill"
              style={{ width: `${Math.min(100, Number(vestedBps) / 100).toFixed(1)}%` }}
            />
          </div>
          <div className="vesting-meta">
            <span>Claimable: {parseFloat(formatUnits(claimable, 18)).toFixed(4)} ETH</span>
            <span>Released: {parseFloat(formatUnits(released, 18)).toFixed(4)} / {parseFloat(formatUnits(total, 18)).toFixed(4)} ETH</span>
          </div>
          {claimable > BigInt(0) && (
            <button
              className="btn-claim"
              onClick={claim}
              disabled={claimPending || claimConfirming}
            >
              {claimPending || claimConfirming ? 'Claiming…' : `Claim ${parseFloat(formatUnits(claimable, 18)).toFixed(4)} ETH`}
            </button>
          )}
          {claimConfirmed && <div className="proj-tx-success">Claimed ✓</div>}
          {claimError && <div className="proj-tx-error">{(claimError as Error).message?.slice(0, 80)}</div>}
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
