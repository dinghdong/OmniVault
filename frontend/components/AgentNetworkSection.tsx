'use client';
import { useMemo } from 'react';
import { formatEther } from 'viem';
import { useProjects } from '../hooks/useProjects';
import { useReadContract } from 'wagmi';
import { nfaAddress, nfaAbi, contractChainId } from '../hooks/contracts';

/* ── Deterministic pixel avatar (same algo as agent-sim) ───────────────────── */
function AgentAvatar({ id, color, size = 28 }: { id: number; color: string; size?: number }) {
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

/* ── Derive a color from DID string ─────────────────────────────────────────── */
const AGENT_COLORS = ['#00ff88', '#63b3ed', '#a78bfa', '#f97316', '#f2cc60', '#f472b6'];
function didColor(did: string): string {
  let h = 0;
  for (let i = 0; i < did.length; i++) h = (h * 31 + did.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}

/* ── Derive a numeric "agent id" from token ID embedded in DID ───────────────── */
function agentIdFromDid(did: string): number {
  const m = did.match(/:(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

const STATUS_COLOR: Record<string, string> = {
  Active:           '#00ff88',
  PendingExecution: '#f2cc60',
  Auditing:         '#63b3ed',
  Pending:          'rgba(255,255,255,0.35)',
  Rejected:         '#f87171',
  Vetoed:           '#f87171',
  CircuitBroken:    '#f97316',
};

function abbrev(s: string, head = 8, tail = 6) {
  if (!s || s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function timeAgo(ts: bigint): string {
  if (!ts || ts === 0n) return '';
  const secs = Math.floor(Date.now() / 1000) - Number(ts);
  if (secs < 60)        return `${secs}s ago`;
  if (secs < 3600)      return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)     return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/* ── A single activity row ──────────────────────────────────────────────────── */
function ActivityRow({ p, isNew }: { p: any; isNew: boolean }) {
  const color  = didColor(p.agentDid);
  const agId   = agentIdFromDid(p.agentDid);
  const status = p.statusLabel as string;
  const sc     = STATUS_COLOR[status] ?? 'rgba(255,255,255,0.3)';
  const isActive = status === 'Active';

  const projectName = p.bizApi
    ? p.bizApi.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/^https?:\/\//, '')
    : `Project #${p.projectId}`;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 16px',
      background: isNew ? 'rgba(0,255,136,0.03)' : 'transparent',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      transition: 'background 0.4s',
      position: 'relative',
    }}>
      {/* Active pulse */}
      {isActive && (
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: '#00ff88', opacity: 0.7, borderRadius: '2px 0 0 2px' }} />
      )}

      <AgentAvatar id={agId} color={color} size={28} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color, opacity: 0.85, letterSpacing: '0.02em',
          }}>
            {abbrev(p.agentDid, 20, 8)}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            color: sc, background: `${sc}12`,
            border: `1px solid ${sc}30`,
            padding: '1px 6px', borderRadius: 4,
          }}>{status}</span>
          {p.auditScore > 0 && (
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
              color: '#f2cc60', opacity: 0.8,
            }}>score {p.auditScore}</span>
          )}
        </div>
        <div style={{
          marginTop: 3,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: 'rgba(255,255,255,0.55)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {projectName}
        </div>
        <div style={{
          marginTop: 2,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: 'rgba(255,255,255,0.2)',
        }}>
          {formatEther(p.requestedAmount || 0n)} ETH req · {timeAgo(p.submittedAt)}
        </div>
      </div>
    </div>
  );
}

/* ── Main exported section ──────────────────────────────────────────────────── */
export default function AgentNetworkSection() {
  const { projects, isLoading } = useProjects();

  // Total NFA supply
  const { data: totalNFA } = useReadContract({
    address: nfaAddress, abi: nfaAbi, functionName: 'totalSupply',
    chainId: contractChainId,
    query: { refetchInterval: 30_000 },
  });
  const totalAgents = totalNFA ? Number(totalNFA as bigint) : 0;

  // Agent-submitted projects (have a DID), sorted newest first
  const agentProjects = useMemo(
    () => [...projects]
      .filter(p => p.agentDid && p.agentDid.startsWith('did:'))
      .sort((a, b) => Number(b.submittedAt - a.submittedAt))
      .slice(0, 20),
    [projects]
  );

  const activeCount  = agentProjects.filter(p => p.statusLabel === 'Active').length;
  const pendingCount = agentProjects.filter(p => ['Pending','Auditing','PendingExecution'].includes(p.statusLabel)).length;

  return (
    <section className="apply-section" id="apply">
      <style>{`
        @keyframes agnet-pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes agnet-scroll { 0%{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        .agnet-row:first-child { animation: agnet-scroll 0.3s ease; }
        .agnet-cta-btn { transition: all 0.2s; }
        .agnet-cta-btn:hover { background: #00ff88 !important; color: #08090d !important; box-shadow: 0 0 28px rgba(0,255,136,0.25) !important; transform: translateY(-1px); }
        .agnet-sim-btn { transition: all 0.2s; }
        .agnet-sim-btn:hover { border-color: rgba(0,255,136,0.5) !important; background: rgba(0,255,136,0.06) !important; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

        {/* Section header */}
        <div style={{ marginBottom: 40 }}>
          <div className="badge" style={{ marginBottom: '1.25rem', display: 'inline-flex' }}>
            <span className="badge-dot" style={{ animation: 'agnet-pulse 1.8s infinite' }} />
            A2A Protocol · Live
          </div>
          <h2 className="section-title" style={{ marginBottom: '0.5rem' }}>Agent Network</h2>
          <p className="section-subtitle" style={{ marginTop: '0.5rem' }}>
            Autonomous AI agents discover, evaluate, and submit Web3 projects 24/7 using on-chain NFA identities.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

          {/* ── Left: Activity feed ────────────────────────────────────────── */}
          <div style={{
            background: '#0d1117',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12, overflow: 'hidden',
          }}>

            {/* Terminal title bar */}
            <div style={{
              padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.25)',
            }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {['#f87171', '#f2cc60', '#00ff88'].map((c, i) =>
                  <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.55 }} />
                )}
              </div>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                color: 'rgba(255,255,255,0.3)', marginLeft: 4,
              }}>omnivault — agent_activity.log</span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff88', animation: 'agnet-pulse 1.8s infinite' }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
                  {isLoading ? 'loading…' : `${agentProjects.length} events`}
                </span>
              </div>
            </div>

            {/* Feed entries */}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {isLoading ? (
                <div style={{
                  padding: '32px 16px', textAlign: 'center',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: 'rgba(255,255,255,0.2)',
                }}>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.12)', borderTopColor: '#00ff88', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 0.8s linear infinite' }} />
                  Fetching on-chain events…
                </div>
              ) : agentProjects.length === 0 ? (
                <div style={{
                  padding: '36px 16px', textAlign: 'center',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: 'rgba(255,255,255,0.2)', lineHeight: 1.7,
                }}>
                  <div style={{ fontSize: 22, marginBottom: 10, opacity: 0.4 }}>⬡</div>
                  No agent submissions yet.{'\n'}
                  <a href="/agent-sim" style={{ color: '#00ff88', textDecoration: 'none' }}>Run the first agent →</a>
                </div>
              ) : (
                agentProjects.map((p, i) =>
                  <div key={p.projectId} className="agnet-row">
                    <ActivityRow p={p} isNew={i === 0} />
                  </div>
                )
              )}
            </div>

            {/* Footer: stats bar */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', gap: 20, background: 'rgba(0,0,0,0.15)',
            }}>
              {[
                { label: 'active', value: activeCount,  color: '#00ff88' },
                { label: 'auditing', value: pendingCount, color: '#63b3ed' },
                { label: 'agents', value: totalAgents,  color: 'rgba(255,255,255,0.4)' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: s.color, fontWeight: 600 }}>{s.value}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>{s.label.toUpperCase()}</span>
                </div>
              ))}
              <div style={{ marginLeft: 'auto' }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                  color: 'rgba(255,255,255,0.15)', letterSpacing: '0.06em',
                }}>arb-sepolia · refetch 10s</span>
              </div>
            </div>
          </div>

          {/* ── Right: CTA cards ──────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Agent Hub card: mint NFA + submit project in one flow */}
            <div style={{
              background: '#0d1117',
              border: '1px solid rgba(0,255,136,0.15)',
              borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{ padding: '18px 20px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="1" width="12" height="12" rx="2" stroke="#00ff88" strokeWidth="1.2"/>
                      <path d="M3.5 5L5.5 7L3.5 9" stroke="#00ff88" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M7 9h3.5" stroke="#00ff88" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#fff', fontWeight: 500 }}>Agent Hub</span>
                  <span style={{
                    marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                    color: '#00ff88', background: 'rgba(0,255,136,0.08)',
                    border: '1px solid rgba(0,255,136,0.2)', padding: '1px 6px', borderRadius: 4,
                  }}>DEVTOOL</span>
                </div>

                <p style={{
                  margin: '0 0 14px',
                  fontFamily: 'inherit', fontSize: 13,
                  color: 'rgba(255,255,255,0.45)', lineHeight: 1.6,
                }}>
                  Mint an NFA identity and submit projects to the AI audit pipeline. One place to manage your on-chain Agent.
                </p>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  {['did:nfa:…', 'ERC-721', 'submitProject', 'arb-sepolia'].map(tag => (
                    <span key={tag} style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      padding: '2px 7px', borderRadius: 4,
                    }}>{tag}</span>
                  ))}
                </div>

                <a href="/agent-sim" className="agnet-cta-btn" style={{
                  display: 'block', textAlign: 'center',
                  padding: '11px 16px',
                  background: 'rgba(0,255,136,0.06)',
                  border: '1px solid rgba(0,255,136,0.25)',
                  borderRadius: 8, color: '#00ff88',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                  fontWeight: 500, textDecoration: 'none',
                  letterSpacing: '0.03em',
                }}>
                  Open Agent Hub →
                </a>
              </div>
            </div>

            {/* How it works mini list */}
            <div style={{
              padding: '14px 16px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 10,
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em',
                marginBottom: 12,
              }}>A2A PROTOCOL FLOW</div>
              {[
                ['01', 'Agent discovers projects via GitHub / IPFS'],
                ['02', 'Claude evaluates: reliability · quality · market fit'],
                ['03', 'im.submitProject() signed with NFA DID'],
                ['04', 'Oracle settles score on-chain → investment executes'],
              ].map(([n, label]) => (
                <div key={n} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#00ff88', opacity: 0.5, flexShrink: 0, marginTop: 1 }}>{n}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>{label}</span>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
