'use client';
import { useReadContracts } from 'wagmi';
import { useAccount } from 'wagmi';
import { formatEther, formatUnits } from 'viem';
import {
  fundTokenAddress, fundTokenAbi,
  investmentManagerAddress, investmentManagerAbi,
  PROJECT_STATUS,
} from '../hooks/contracts';
import { useProjects } from '../hooks/useProjects';

// ─── Mini sparkline (SVG) ─────────────────────────────────────────────────────
function RebaseSparkline({ accrualFactor }: { accrualFactor: bigint }) {
  const base = Number(accrualFactor) / 1e18;
  const POINTS = 20;
  const W = 200, H = 60;

  // Simulate compound growth: reverse-engineer rate from accrualFactor
  // Assume accrualFactor grew from 1.0 at T=0 to `base` linearly (simplistic)
  const pts: [number, number][] = Array.from({ length: POINTS }, (_, i) => {
    const t = i / (POINTS - 1);
    const y = 1 + (base - 1) * t;
    return [t * W, H - ((y - 1) / Math.max(base - 1, 0.001)) * (H * 0.8) - 4];
  });

  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fill = `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${W},${H} L0,${H} Z`;

  const yieldPct = ((base - 1) * 100).toFixed(3);

  return (
    <div className="lp-sparkline-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60 }}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#00ff88" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00ff88" stopOpacity="0"    />
          </linearGradient>
        </defs>
        <path d={fill} fill="url(#sparkFill)" />
        <path d={d} stroke="#00ff88" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
      <div className="lp-sparkline-label">
        <span>Cumulative yield</span>
        <strong style={{ color: '#00ff88' }}>+{yieldPct}%</strong>
      </div>
    </div>
  );
}

// ─── Project health badge ──────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  Active:           '#00ff88',
  Pending:          '#facc15',
  Auditing:         '#63b3ed',
  PendingExecution: '#a78bfa',
  Rejected:         '#f87171',
  Vetoed:           '#f87171',
  Exited:           '#8b949e',
  WriteOff:         '#f87171',
  CircuitBroken:    '#f97316',
};

function HealthBar({ projects }: { projects: any[] }) {
  const counts: Record<string, number> = {};
  for (const p of projects) {
    const label = PROJECT_STATUS[p.statusNum] ?? 'Unknown';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const total = projects.length || 1;

  return (
    <div className="lp-health-bar-wrap">
      <div className="lp-health-bar">
        {Object.entries(counts).map(([label, n]) => (
          <div
            key={label}
            className="lp-health-segment"
            style={{ width: `${(n / total) * 100}%`, background: STATUS_COLOR[label] ?? '#484f58' }}
            title={`${label}: ${n}`}
          />
        ))}
      </div>
      <div className="lp-health-legend">
        {Object.entries(counts).map(([label, n]) => (
          <span key={label} className="lp-health-item">
            <span className="lp-health-dot" style={{ background: STATUS_COLOR[label] ?? '#484f58' }} />
            {label} ({n})
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LPDashboard() {
  const { address } = useAccount();
  const { projects, isLoading: projectsLoading } = useProjects();

  const { data, isLoading: statsLoading } = useReadContracts({
    contracts: [
      { address: fundTokenAddress, abi: fundTokenAbi, functionName: 'totalSupply' },
      { address: fundTokenAddress, abi: fundTokenAbi, functionName: 'accrualFactor' },
      { address: fundTokenAddress, abi: fundTokenAbi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000' as `0x${string}`] },
      { address: fundTokenAddress, abi: fundTokenAbi, functionName: 'getShares',  args: [address ?? '0x0000000000000000000000000000000000000000' as `0x${string}`] },
    ],
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const totalSupply   = data?.[0]?.result as bigint | undefined;
  const accrualFactor = data?.[1]?.result as bigint | undefined;
  const userBalance   = data?.[2]?.result as bigint | undefined;
  const userShares    = data?.[3]?.result as bigint | undefined;

  // TVL
  const tvlWei = (totalSupply && accrualFactor)
    ? (totalSupply * accrualFactor / BigInt('1000000000000000000'))
    : BigInt(0);
  const tvlEth = parseFloat(formatEther(tvlWei));

  // Pool share %
  const poolSharePct = (userShares && totalSupply && totalSupply > BigInt(0))
    ? (Number(userShares) / Number(totalSupply) * 100).toFixed(3)
    : '0.000';

  // User ETH value
  const userEth = userBalance ? parseFloat(formatEther(userBalance)) : 0;

  // Active / troubled / exited projects
  const active    = projects.filter(p => p.statusNum === 5);
  const troubled  = projects.filter(p => [6, 8, 9].includes(p.statusNum));
  const exited    = projects.filter(p => p.statusNum === 7);
  const totalInvested      = active.reduce((acc, p) => acc + Number(formatEther(p.investmentAmount)), 0);
  const totalExitInvested  = exited.reduce((acc, p) => acc + Number(formatEther(p.investmentAmount)), 0);
  const totalExitReturns   = exited.reduce((acc, p) => acc + Number(formatEther(p.exitProceeds)),    0);
  const portfolioRoi       = totalExitInvested > 0 ? (totalExitReturns / totalExitInvested * 100 - 100) : 0;

  const isLoading = statsLoading || projectsLoading;

  if (!address) return null;

  return (
    <div className="lp-dashboard">
      <div className="lp-dashboard-title">Your LP Dashboard</div>

      <div className="lp-stats-grid">
        {/* Holdings */}
        <div className="lp-card">
          <div className="lp-card-label">Your Holdings</div>
          <div className="lp-card-value">{userEth.toFixed(6)} ETH</div>
          <div className="lp-card-sub">{poolSharePct}% of pool · {parseFloat(formatUnits(userShares ?? BigInt(0), 18)).toFixed(6)} shares</div>
        </div>

        {/* Vault TVL */}
        <div className="lp-card">
          <div className="lp-card-label">Vault TVL</div>
          <div className="lp-card-value">{tvlEth >= 1000 ? `${(tvlEth/1000).toFixed(2)}K` : tvlEth.toFixed(4)} ETH</div>
          <div className="lp-card-sub">ETH-only vault · no AAVE</div>
        </div>

        {/* Portfolio at work */}
        <div className="lp-card">
          <div className="lp-card-label">Deployed Capital</div>
          <div className="lp-card-value">{totalInvested.toFixed(4)} ETH</div>
          <div className="lp-card-sub">{active.length} active project{active.length !== 1 ? 's' : ''}</div>
        </div>

        {/* Alert count */}
        <div className="lp-card" style={troubled.length > 0 ? { borderColor: 'rgba(249,115,22,0.4)' } : {}}>
          <div className="lp-card-label">Alerts</div>
          <div className="lp-card-value" style={{ color: troubled.length > 0 ? '#f97316' : '#00ff88' }}>
            {troubled.length}
          </div>
          <div className="lp-card-sub">{troubled.length > 0 ? 'circuit breaks / write-offs' : 'No active alerts'}</div>
        </div>
      </div>

      {/* Rebase curve */}
      {accrualFactor && (
        <div className="lp-rebase-section">
          <div className="lp-section-title">Rebasing Curve</div>
          <RebaseSparkline accrualFactor={accrualFactor} />
          <div className="lp-rebase-meta">
            accrualFactor = {(Number(accrualFactor) / 1e18).toFixed(8)}
            <span className="lp-rebase-note"> · grows as AI investments return gains to vault</span>
          </div>
        </div>
      )}

      {/* Project health bar */}
      {projects.length > 0 && (
        <div className="lp-rebase-section">
          <div className="lp-section-title">Pipeline Health — {projects.length} project{projects.length !== 1 ? 's' : ''}</div>
          <HealthBar projects={projects} />
        </div>
      )}

      {/* Troubled project list */}
      {troubled.length > 0 && (
        <div className="lp-alerts">
          <div className="lp-section-title" style={{ color: '#f97316' }}>⚠ Monitoring Alerts</div>
          {troubled.map(p => (
            <div key={p.projectId} className="lp-alert-row">
              <span className="lp-alert-id">Project #{p.projectId}</span>
              <span className="lp-alert-status" style={{ color: STATUS_COLOR[PROJECT_STATUS[p.statusNum]] ?? '#f87171' }}>
                {PROJECT_STATUS[p.statusNum]}
              </span>
              <span className="lp-alert-amt">{parseFloat(formatEther(p.investmentAmount)).toFixed(4)} ETH at risk</span>
            </div>
          ))}
        </div>
      )}

      {/* Exited investments P&L */}
      {exited.length > 0 && (
        <div className="lp-alerts">
          <div className="lp-section-title" style={{ color: '#8b949e' }}>→ Exited Investments ({exited.length})</div>
          <div className="lp-stats-grid" style={{ marginBottom: 10 }}>
            <div className="lp-card">
              <div className="lp-card-label">Capital Deployed</div>
              <div className="lp-card-value">{totalExitInvested.toFixed(4)} ETH</div>
            </div>
            <div className="lp-card">
              <div className="lp-card-label">Total Returns</div>
              <div className="lp-card-value" style={{ color: totalExitReturns >= totalExitInvested ? '#00ff88' : '#f87171' }}>
                {totalExitReturns.toFixed(4)} ETH
              </div>
            </div>
            <div className="lp-card">
              <div className="lp-card-label">Portfolio ROI</div>
              <div className="lp-card-value" style={{ color: portfolioRoi >= 0 ? '#00ff88' : '#f87171' }}>
                {portfolioRoi >= 0 ? '+' : ''}{portfolioRoi.toFixed(2)}%
              </div>
            </div>
          </div>
          {exited.map(p => (
            <div key={p.projectId} className="lp-alert-row">
              <span className="lp-alert-id">Project #{p.projectId}</span>
              <span className="lp-alert-status" style={{ color: '#8b949e' }}>Exited</span>
              <span className="lp-alert-amt">
                {parseFloat(formatEther(p.investmentAmount)).toFixed(4)} ETH →{' '}
                <span style={{ color: p.exitProceeds >= p.investmentAmount ? '#00ff88' : '#f87171' }}>
                  {parseFloat(formatEther(p.exitProceeds)).toFixed(4)} ETH
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="lp-loading">
          <div className="asv-spinner-sm" />
          <span>Loading portfolio data…</span>
        </div>
      )}
    </div>
  );
}
