'use client';
import { useState, useCallback, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther, encodeAbiParameters } from 'viem';
import {
  nfaAddress, nfaAbi,
  fundVaultAddress, fundVaultAbi,
  mockPolyMarketAddress, mockPolyMarketAbi,
  contractChainId,
  worldCupAgentVaultAddress,
} from '../hooks/contracts';
import { useProjectSubmit } from '../hooks/useProjectSubmit';
import PageHeader from '../components/PageHeader';

/* ─── Geometric pixel avatar from token ID ───────────────────────────────── */
function AgentAvatar({ id, color, size = 34 }: { id: number; color: string; size?: number }) {
  const grid = Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => c === 2
      ? ((id * 137 + r * 31) % 7 < 4)
      : ((id * 137 + (r * 3 + c) * 31) % 7 < 4)
    )
  );
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.22), overflow: 'hidden', background: '#010409', border: `1px solid ${color}40`, flexShrink: 0 }}>
      <svg viewBox="0 0 3 3" width={size} height={size}>
        {grid.map((row, r) => row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill={color} opacity={0.85} /> : null
        ))}
      </svg>
    </div>
  );
}

const AGENT_COLORS = ['#00ff88', '#00f0ff', '#ffb800', '#ff2a6d', '#a78bfa'];

const BET_REQUEST_TYPES = [
  { name: 'matchId', type: 'uint256' },
  { name: 'outcomeIndex', type: 'uint256' },
  { name: 'betAmount', type: 'uint256' },
  { name: 'minOdds', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
] as const;

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function oddsString(oddsWei: bigint) {
  return parseFloat(formatEther(oddsWei)).toFixed(2);
}

function toDateTimeLocal(tsSec: number) {
  const d = new Date(tsSec * 1000);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function AgentSimPage() {
  const { address } = useAccount();
  const { submit, state, reset: resetSubmit } = useProjectSubmit();

  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [contractAddr, setContractAddr] = useState(worldCupAgentVaultAddress);
  const [amount, setAmount]             = useState('');
  const [initData, setInitData]         = useState<`0x${string}`>('0x');
  const [localError, setLocalError]     = useState('');
  const [showMintForm, setShowMintForm] = useState(false);
  const [mintRepo, setMintRepo]         = useState('');
  const [mintApi, setMintApi]           = useState('');
  const [mintModel, setMintModel]       = useState('');
  const [mintMrenclave, setMintMrenclave] = useState('');
  const [mintPubKey, setMintPubKey]     = useState('');

  // BetRequest builder state
  const [matchId, setMatchId]           = useState('');
  const [outcomeIndex, setOutcomeIndex] = useState('0');
  const [betAmount, setBetAmount]       = useState('');
  const [minOdds, setMinOdds]           = useState('');
  const [deadline, setDeadline]         = useState('');
  const [nonce, setNonce]               = useState('0');

  // ── Mint NFA ───────────────────────────────────────────────────────────────
  const {
    writeContract: writeMint,
    data: mintTxHash,
    isPending: isMintPending,
    error: mintError,
    reset: resetMint,
  } = useWriteContract();

  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed } =
    useWaitForTransactionReceipt({ hash: mintTxHash });

  const handleMint = useCallback(() => {
    if (!address) return;
    if (!mintRepo.trim()) { setLocalError('Agent repo is required'); return; }
    if (!mintApi.trim()) { setLocalError('API endpoint is required'); return; }
    if (!mintModel.trim()) { setLocalError('Model is required'); return; }
    const mre = mintMrenclave.trim();
    const pk = mintPubKey.trim();
    if (!mre || !/^0x[0-9a-fA-F]{64}$/.test(mre)) { setLocalError('teeMrenclave must be a 0x-prefixed 32-byte hex string'); return; }
    if (!pk || !/^0x[0-9a-fA-F]+$/.test(pk)) { setLocalError('teePublicKey must be hex bytes'); return; }
    setLocalError('');
    writeMint({
      address: nfaAddress,
      abi: nfaAbi,
      functionName: 'mint',
      args: [mintRepo.trim(), mintApi.trim(), mintModel.trim(), mre as `0x${string}`, pk as `0x${string}`],
      chainId: contractChainId,
      account: address,
    } as any);
  }, [writeMint, address, mintRepo, mintApi, mintModel, mintMrenclave, mintPubKey]);

  useEffect(() => {
    if (isMintConfirmed) {
      setShowMintForm(false);
      setMintRepo('');
      setMintApi('');
      setMintModel('');
      setMintMrenclave('');
      setMintPubKey('');
      resetMint();
    }
  }, [isMintConfirmed, resetMint]);

  // ── Chain reads ────────────────────────────────────────────────────────────
  const { data: tokenIds } = useReadContract({
    address: nfaAddress, abi: nfaAbi, functionName: 'tokensOfOwner',
    args: [address ?? '0x0000000000000000000000000000000000000000' as `0x${string}`],
    chainId: contractChainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const ids = (tokenIds as bigint[] | undefined) ?? [];

  const { data: agentMetas } = useReadContracts({
    contracts: ids.map(id => ({ address: nfaAddress, abi: nfaAbi, functionName: 'getAgent' as const, args: [id] as const, chainId: contractChainId })),
    query: { enabled: ids.length > 0 },
  });

  const { data: vaultBalRaw } = useReadContract({
    address: fundVaultAddress, abi: fundVaultAbi, functionName: 'vaultBalance',
    chainId: contractChainId,
    query: { refetchInterval: 15_000 },
  });

  const { data: matchCountRaw } = useReadContract({
    address: mockPolyMarketAddress, abi: mockPolyMarketAbi, functionName: 'matchCount',
    chainId: contractChainId,
    query: { refetchInterval: 15_000 },
  });

  const matchCount = Number((matchCountRaw as bigint | undefined) ?? 0n);
  const matchContracts = Array.from({ length: matchCount }, (_, i) => ({
    address: mockPolyMarketAddress,
    abi: mockPolyMarketAbi,
    functionName: 'matches' as const,
    args: [BigInt(i + 1)] as const,
    chainId: contractChainId,
  }));

  const { data: matchesRaw } = useReadContracts({
    contracts: matchContracts,
    query: { enabled: matchCount > 0 },
  });

  const nowSec = Math.floor(Date.now() / 1000);
  type MatchItem = {
    matchId: number;
    home: string;
    away: string;
    homeOdds: bigint;
    drawOdds: bigint;
    awayOdds: bigint;
    expiration: number;
    totalPool: bigint;
    outcome: number;
    status: number;
  };
  const rawMatches: MatchItem[] = (matchesRaw ?? [])
    .map((r, i) => {
      if (r.status !== 'success') return null;
      const m = r.result as [string, string, bigint, bigint, bigint, bigint, bigint, number, number];
      return {
        matchId: i + 1,
        home: m[0],
        away: m[1],
        homeOdds: m[2],
        drawOdds: m[3],
        awayOdds: m[4],
        expiration: Number(m[5]),
        totalPool: m[6],
        outcome: m[7],
        status: m[8],
      };
    })
    .filter((m): m is MatchItem =>
      m !== null && m.status === 0 && m.expiration > nowSec
    );

  // Deduplicate by home/away pair, keep the latest matchId
  const matches = Array.from(
    rawMatches.reduce((acc, m) => {
      const key = `${m.home}-${m.away}`;
      const existing = acc.get(key);
      if (!existing || m.matchId > existing.matchId) {
        acc.set(key, m);
      }
      return acc;
    }, new Map<string, MatchItem>()).values()
  ).sort((a, b) => b.matchId - a.matchId);

  const vaultBal = vaultBalRaw ? parseFloat(formatEther(vaultBalRaw as bigint)).toFixed(4) : '—';

  // Build agent list
  const agents = ids.map((id, i) => {
    const meta = agentMetas?.[i]?.status === 'success' ? (agentMetas[i].result as any) : null;
    return {
      id: Number(id),
      repo:        meta?.repo        ?? '',
      apiEndpoint: meta?.apiEndpoint ?? '',
      model:       meta?.model       ?? '',
      color: AGENT_COLORS[i % AGENT_COLORS.length],
    };
  });

  const selected = agents.find(a => a.id === selectedId) ?? null;

  // ── BetRequest encoder ─────────────────────────────────────────────────────
  const encodedBetRequest = useMemo(() => {
    try {
      if (!matchId || !betAmount || !minOdds || !deadline) return '0x' as `0x${string}`;
      const dl = Math.floor(new Date(deadline).getTime() / 1000);
      if (Number.isNaN(dl)) return '0x' as `0x${string}`;
      return encodeAbiParameters(
        [...BET_REQUEST_TYPES],
        [
          BigInt(matchId),
          BigInt(outcomeIndex),
          parseEther(betAmount as `${number}`),
          parseEther(minOdds as `${number}`),
          BigInt(dl),
          BigInt(nonce || 0),
        ]
      );
    } catch {
      return '0x' as `0x${string}`;
    }
  }, [matchId, outcomeIndex, betAmount, minOdds, deadline, nonce]);

  useEffect(() => {
    if (encodedBetRequest && encodedBetRequest !== '0x') {
      setInitData(encodedBetRequest);
    }
  }, [encodedBetRequest]);

  const selectOutcome = (m: typeof matches[number], idx: number) => {
    setMatchId(String(m.matchId));
    setOutcomeIndex(String(idx));
    const odds = [m.homeOdds, m.drawOdds, m.awayOdds][idx];
    setMinOdds(oddsString(odds));
    setDeadline(toDateTimeLocal(m.expiration));
    setNonce(String(Math.floor(Math.random() * 1e12)));
    if (!betAmount) setBetAmount(amount || '0.01');
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const effectiveInitData = (initData && initData !== '0x') ? initData : encodedBetRequest;

  const handleExecute = async () => {
    setLocalError('');
    if (!address)     { setLocalError('Connect wallet first.'); return; }
    if (!selected)    { setLocalError('Select an NFA agent.'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddr)) { setLocalError('Enter a valid target contract address.'); return; }
    if (!amount || parseFloat(amount) <= 0) { setLocalError('Enter funding amount.'); return; }
    const data = effectiveInitData;
    if (!data || data === '0x') { setLocalError('Select a match and build a BetRequest.'); return; }

    try {
      const { parseEther } = await import('viem');
      submit(
        contractAddr as `0x${string}`,
        parseEther(amount as `${number}`),
        selected.id,
        data,
      );
    } catch (e: any) { setLocalError(e?.message ?? 'Execute failed'); }
  };

  // After confirmed
  if (state.isConfirmed && state.projectId !== null) {
    return (
      <div className="agent-sim-root">
        <div className="agent-sim-container">
          <div className="as-success">
            <div className="as-success-icon">✓</div>
            <div className="as-success-title">Project #{state.projectId} Submitted</div>
            <div className="as-mono" style={{ color: 'var(--as-text-dim)' }}>{state.hash?.slice(0, 22)}…</div>
            <button
              className="as-btn-primary"
              style={{ maxWidth: 280, marginTop: 12 }}
              onClick={() => { resetSubmit(); setContractAddr(worldCupAgentVaultAddress); setAmount(''); setInitData('0x'); setSelectedId(null); setMatchId(''); setBetAmount(''); }}
            >
              ← New Simulation
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Agent Hub — OmniVault</title>
      </Head>

      <div className="agent-sim-root">
        <div className="agent-sim-container">

          <PageHeader
            backHref="/"
            backLabel="Back to OmniVault"
            label="Autonomous Agent Interface"
            title="Agent Hub"
            badge="Live on Arbitrum Sepolia"
            badgePulse
          />

          <div className="as-demo-notice">
            <div className="as-demo-icon">🏆</div>
            <div>
              <div className="as-demo-title">Demo 提示</div>
              <p>
                当前 Agent Hub 以「世界杯预测 Agent」为例，演示一个 AI Agent 如何自动发现比赛、生成预测、
                提交 Funding 申请并进入 OmniVault 审计流程。
              </p>
              <ol className="as-demo-steps">
                <li>选择一场模拟世界杯比赛</li>
                <li>Agent 自动获取赔率并生成 BetRequest</li>
                <li>提交 Project 到 OmniVault 合约</li>
                <li>AI Auditor 在 TEE 中验证预测逻辑</li>
                <li>通过审计后进入 Funding / 执行阶段</li>
              </ol>
            </div>
          </div>

          <main className="as-grid">

            {/* LEFT COLUMN */}
            <div className="as-col">

              {/* Agent Identity */}
              <section className="as-panel as-panel-pad" style={{ marginBottom: 20 }}>
                <div className="as-section-head">Agent Identity</div>

                {!address ? (
                  <div className="as-alert">Connect wallet to view your NFA tokens.</div>
                ) : agents.length === 0 ? (
                  <>
                    <div className="as-mono" style={{ color: 'var(--as-text-dim)', fontSize: 13, marginBottom: 14 }}>
                      No NFA tokens found for {address.slice(0, 8)}…
                    </div>
                    <button className="as-agent-add" onClick={() => setShowMintForm(true)}>
                      <span>+</span> Mint Agent Identity
                    </button>
                  </>
                ) : (
                  <div className="as-agent-list">
                    {agents.map(agent => {
                      const sel = selectedId === agent.id;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => setSelectedId(sel ? null : agent.id)}
                          className={`as-agent-pill ${sel ? 'selected' : ''}`}
                        >
                          <AgentAvatar id={agent.id} color={agent.color} size={28} />
                          <div>
                            <div className="as-agent-pill-name" style={sel ? { color: agent.color } : undefined}>
                              Agent #{String(agent.id).padStart(3, '0')}
                            </div>
                            <div className="as-agent-pill-model">{agent.model || '—'}</div>
                          </div>
                        </button>
                      );
                    })}
                    <button className="as-agent-add" onClick={() => setShowMintForm(true)}>
                      <span>+</span> Mint
                    </button>
                  </div>
                )}

                {selected && (
                  <div className="as-agent-card" style={{ borderLeftColor: selected.color }}>
                    <div className="as-agent-card-row"><span className="as-agent-card-key">id</span><span className="as-agent-card-val">{selected.id}</span></div>
                    <div className="as-agent-card-row"><span className="as-agent-card-key">repo</span><span style={{ color: 'var(--as-text)' }}>{selected.repo || '—'}</span></div>
                    <div className="as-agent-card-row"><span className="as-agent-card-key">endpoint</span><span style={{ color: 'var(--as-text)' }}>{selected.apiEndpoint || '—'}</span></div>
                    <div className="as-agent-card-row"><span className="as-agent-card-key">model</span><span style={{ color: 'var(--as-text)' }}>{selected.model || '—'}</span></div>
                  </div>
                )}

                {showMintForm && (
                  <>
                    <div className="as-divider" />
                    <div className="as-mint-grid">
                      <div>
                        <label className="as-label">Repo URL</label>
                        <input className="as-input" placeholder="github.com/..." value={mintRepo} onChange={e => setMintRepo(e.target.value)} />
                      </div>
                      <div>
                        <label className="as-label">API Endpoint</label>
                        <input className="as-input" placeholder="https://..." value={mintApi} onChange={e => setMintApi(e.target.value)} />
                      </div>
                      <div>
                        <label className="as-label">Model</label>
                        <input className="as-input" placeholder="claude-3.5-sonnet" value={mintModel} onChange={e => setMintModel(e.target.value)} />
                      </div>
                      <div>
                        <label className="as-label">teeMrenclave</label>
                        <input className="as-input" placeholder="0x + 64 hex" value={mintMrenclave} onChange={e => setMintMrenclave(e.target.value)} />
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label className="as-label">teePublicKey</label>
                        <input className="as-input" placeholder="0x..." value={mintPubKey} onChange={e => setMintPubKey(e.target.value)} />
                      </div>
                    </div>
                    {(localError || mintError) && (
                      <div className="as-alert error" style={{ marginTop: 12 }}>{(mintError as any)?.shortMessage ?? localError ?? String(mintError)}</div>
                    )}
                    <div className="as-input-row" style={{ marginTop: 14 }}>
                      <button className="as-btn-primary" disabled={isMintPending || isMintConfirming} onClick={handleMint} style={{ flex: 1 }}>
                        {isMintPending || isMintConfirming ? 'Minting…' : 'Mint NFA'}
                      </button>
                      <button className="as-btn-secondary" onClick={() => { setShowMintForm(false); setLocalError(''); resetMint(); }}>
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </section>

              {/* Project Target */}
              <section className="as-panel as-panel-pad" style={{ marginBottom: 20 }}>
                <div className="as-section-head">Project Target</div>
                <label className="as-label">Contract Address</label>
                <input className="as-input as-mono" value={contractAddr} onChange={e => setContractAddr(e.target.value as `0x${string}`)} />
              </section>

              {/* Funding */}
              <section className="as-panel as-panel-pad">
                <div className="as-section-head">Funding Request</div>
                <div className="as-input-row">
                  <input className="as-input" type="number" min="0" step="0.001" placeholder="0.010" value={amount} onChange={e => setAmount(e.target.value)} style={{ maxWidth: 160 }} />
                  <span className="as-eth-suffix">ETH</span>
                  <span className="as-vault-hint">vault: {vaultBal} ETH avail</span>
                </div>
              </section>

            </div>

            {/* RIGHT COLUMN */}
            <div className="as-col">

              {/* Matches */}
              <section className="as-panel as-panel-pad" style={{ marginBottom: 20 }}>
                <div className="as-section-head">Available Matches</div>
                {matches.length === 0 ? (
                  <div className="as-alert">No open matches found. Run <code>scripts/create-matches.ts</code> to seed demo data.</div>
                ) : (
                  <div className="as-match-grid">
                    {matches.map(m => {
                      const selectedMatch = matchId === String(m.matchId);
                      return (
                        <div
                          key={m.matchId}
                          className={`as-match-card ${selectedMatch ? 'selected' : ''}`}
                        >
                          <div className="as-match-teams">
                            <div className="as-match-team">{m.home}</div>
                            <div className="as-match-vs">vs</div>
                            <div className="as-match-team">{m.away}</div>
                          </div>
                          <div className="as-odds-row">
                            {[
                              { label: m.home, odds: m.homeOdds, idx: 0 },
                              { label: 'Draw', odds: m.drawOdds, idx: 1 },
                              { label: m.away, odds: m.awayOdds, idx: 2 },
                            ].map(({ label, odds, idx }) => (
                              <button
                                key={idx}
                                type="button"
                                className={`as-odds-btn ${selectedMatch && outcomeIndex === String(idx) ? 'active' : ''}`}
                                onClick={() => selectOutcome(m, idx)}
                              >
                                <span className="as-odds-label">{label}</span>
                                <span className="as-odds-value">{oddsString(odds)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Init Data / Summary */}
              <section className="as-panel as-panel-pad" style={{ marginBottom: 20 }}>
                <div className="as-section-head">Bet Request</div>

                <div className="as-summary-row">
                  <span className="as-summary-key">Match ID</span>
                  <span className="as-summary-val">{matchId || '—'}</span>
                </div>
                <div className="as-summary-row">
                  <span className="as-summary-key">Outcome</span>
                  <span className="as-summary-val">{matchId ? ['Home', 'Draw', 'Away'][Number(outcomeIndex) ?? 0] : '—'}</span>
                </div>
                <div className="as-summary-row">
                  <span className="as-summary-key">Bet Amount</span>
                  <span className="as-summary-val">{betAmount ? `${betAmount} ETH` : '—'}</span>
                </div>
                <div className="as-summary-row">
                  <span className="as-summary-key">Min Odds</span>
                  <span className="as-summary-val">{minOdds || '—'}</span>
                </div>
                <div className="as-summary-row">
                  <span className="as-summary-key">Deadline</span>
                  <span className="as-summary-val">{deadline ? new Date(deadline).toLocaleString() : '—'}</span>
                </div>

                <div style={{ marginTop: 16 }}>
                  <label className="as-label">Encoded Init Data</label>
                  <textarea className="as-hex" rows={3} value={initData} onChange={e => setInitData(e.target.value as `0x${string}`)} />
                </div>
              </section>

              {/* Execute */}
              <section className="as-panel as-panel-pad">
                {localError && <div className="as-alert error" style={{ marginBottom: 16 }}>{localError}</div>}
                {state.error && <div className="as-alert error" style={{ marginBottom: 16 }}>{(state.error as any)?.shortMessage ?? String(state.error)}</div>}
                <button
                  type="button"
                  className="as-btn-primary"
                  disabled={state.isPending || state.isConfirming}
                  onClick={handleExecute}
                >
                  {state.isPending || state.isConfirming ? (
                    <>Submitting…</>
                  ) : (
                    <>Submit Project →</>
                  )}
                </button>
                <div className="as-mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--as-text-dim)', textAlign: 'center' }}>
                  InvestmentManager.submitProject(contractAddr, requestedAmount, agentId, initData)
                </div>
              </section>

            </div>
          </main>

          <div className="as-mono" style={{ marginTop: 40, fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center' }}>
            NFA CONTRACT · {nfaAddress} · ARBITRUM SEPOLIA
          </div>

        </div>
      </div>
    </>
  );
}
