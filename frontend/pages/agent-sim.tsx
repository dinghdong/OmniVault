'use client';
import { useState, useCallback, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther, encodeAbiParameters } from 'viem';
import {
  nfaAddress, nfaAbi,
  fundVaultAddress, fundVaultAbi,
  investmentManagerAddress, investmentManagerAbi,
  mockPolyMarketAddress, mockPolyMarketAbi,
  contractChainId,
  worldCupAgentVaultAddress,
} from '../hooks/contracts';
import { useProjectSubmit } from '../hooks/useProjectSubmit';

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function oddsString(oddsWei: bigint) {
  return parseFloat(formatEther(oddsWei)).toFixed(2);
}

function toDateTimeLocal(tsSec: number) {
  const d = new Date(tsSec * 1000);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

/* ─── Geometric pixel avatar from token ID ───────────────────────────────── */
function AgentAvatar({ id, color, size = 34 }: { id: number; color: string; size?: number }) {
  const grid = Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => c === 2
      ? ((id * 137 + r * 31) % 7 < 4)   // mirror col 0
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

const AGENT_COLORS = ['#00ff88', '#63b3ed', '#a78bfa', '#f97316', '#f2cc60'];

const BET_REQUEST_TYPES = [
  { name: 'matchId', type: 'uint256' },
  { name: 'outcomeIndex', type: 'uint256' },
  { name: 'betAmount', type: 'uint256' },
  { name: 'minOdds', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
] as const;

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
  const matches = (matchesRaw ?? [])
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
    .filter((m): m is NonNullable<typeof m> =>
      m !== null && m.status === 0 && m.expiration > nowSec
    );

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

  const applyEncodedBet = () => {
    if (encodedBetRequest && encodedBetRequest !== '0x') {
      setInitData(encodedBetRequest);
    }
  };

  useEffect(() => {
    if (encodedBetRequest && encodedBetRequest !== '0x') {
      setInitData(encodedBetRequest);
    }
  }, [encodedBetRequest]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const canExecute = !!selected && !!contractAddr && /^0x[0-9a-fA-F]{40}$/.test(contractAddr)
    && !!amount && parseFloat(amount) > 0
    && !!initData && initData !== '0x'
    && !state.isPending && !state.isConfirming;

  const handleExecute = async () => {
    setLocalError('');
    if (!address)     { setLocalError('Connect wallet first.'); return; }
    if (!selected)    { setLocalError('Select an NFA agent.'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddr)) { setLocalError('Enter a valid target contract address.'); return; }
    if (!amount || parseFloat(amount) <= 0) { setLocalError('Enter funding amount.'); return; }
    if (!initData || initData === '0x') { setLocalError('Provide initData (hex bytes) or build a BetRequest.'); return; }

    try {
      const { parseEther } = await import('viem');
      submit(
        contractAddr as `0x${string}`,
        parseEther(amount as `${number}`),
        selected.id,
        initData,
      );
    } catch (e: any) { setLocalError(e?.message ?? 'Execute failed'); }
  };

  // After confirmed
  if (state.isConfirmed && state.projectId !== null) {
    return (
      <div className="page-container agent-success">
        <div>
          <div className="agent-success-icon">✓</div>
          <div className="agent-success-title">Project #{state.projectId} submitted</div>
          <div className="agent-success-hash">{state.hash?.slice(0, 20)}…</div>
          <button
            className="btn-primary"
            onClick={() => { resetSubmit(); setContractAddr(worldCupAgentVaultAddress); setAmount(''); setInitData('0x'); setSelectedId(null); }}
          >
            ← New Simulation
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Agent Hub — OmniVault</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Syne:wght@500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <div className="detail-page">
        <header className="detail-page-header">
          <Link href="/" className="detail-page-back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </Link>
          <div className="detail-page-title">
            <span className="detail-page-title-label">Agent Hub</span>
            <span className="detail-page-title-id">Submit Project</span>
          </div>
        </header>

        <main className="detail-page-main">
          <div className="detail-card">
            <div className="detail-card-body">

              {/* ① AGENT_IDENTITY */}
              <section>
                <div className="detail-section-label">
                  <span className="detail-section-number">①</span>
                  <span>AGENT_IDENTITY</span>
                  <span className="detail-section-line" />
                </div>

                {!address ? (
                  <div className="agent-wallet-prompt">
                    Connect wallet to view your NFA tokens →{' '}
                    <Link href="/">Connect</Link>
                  </div>
                ) : agents.length === 0 ? (
                  <div className="agent-pills">
                    <div className="agent-wallet-prompt" style={{ padding: 0 }}>
                      No NFA tokens found for {address.slice(0, 8)}…
                    </div>
                    <button
                      type="button"
                      className="agent-pill-add"
                      onClick={() => setShowMintForm(true)}
                    >
                      <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Mint Agent Identity
                    </button>
                  </div>
                ) : (
                  <div className="agent-pills">
                    {agents.map(agent => {
                      const sel = selectedId === agent.id;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => setSelectedId(sel ? null : agent.id)}
                          className={`agent-pill ${sel ? 'selected' : ''}`}
                          style={sel ? { borderColor: agent.color + '50', boxShadow: `0 0 16px ${agent.color}18` } : undefined}
                        >
                          <AgentAvatar id={agent.id} color={agent.color} />
                          <div>
                            <div className={`agent-pill-name ${sel ? 'selected' : ''}`} style={sel ? { color: agent.color } : undefined}>
                              Agent #{String(agent.id).padStart(3, '0')}
                            </div>
                            <div className="agent-pill-model">{agent.model || '—'}</div>
                          </div>
                          {sel && (
                            <div style={{
                              width: 5, height: 5, borderRadius: '50%', background: agent.color,
                              boxShadow: `0 0 8px ${agent.color}`, animation: 'pulse 1.8s infinite'
                            }} />
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="agent-pill-add"
                      onClick={() => setShowMintForm(true)}
                    >
                      <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Mint
                    </button>
                  </div>
                )}

                {selected && (
                  <div className="agent-terminal" style={{ borderLeftColor: selected.color + '80' }}>
                    {(['id', 'repo', 'endpoint', 'model'] as const).map(k => (
                      <div key={k} className="agent-terminal-row">
                        <span style={{ color: 'rgba(255,255,255,0.15)' }}>{'> '}</span>
                        <span className="agent-terminal-key">{k.padEnd(8)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.15)' }}>:</span>
                        <span className="agent-terminal-value" style={{ color: selected.color, opacity: 0.9 }}>
                          {k === 'id' ? selected.id : (selected as any)[k === 'endpoint' ? 'apiEndpoint' : k] || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mint NFA form */}
                {showMintForm && (
                  <div className="agent-mint-form">
                    <div className="agent-mint-title">MINT NEW NFA IDENTITY</div>
                    <div className="input-group">
                      <input className="input-field" placeholder="Repo URL" value={mintRepo} onChange={e => setMintRepo(e.target.value)} />
                    </div>
                    <div className="input-group">
                      <input className="input-field" placeholder="API Endpoint" value={mintApi} onChange={e => setMintApi(e.target.value)} />
                    </div>
                    <div className="input-group">
                      <input className="input-field" placeholder="Model (e.g. claude-3.5-sonnet)" value={mintModel} onChange={e => setMintModel(e.target.value)} />
                    </div>
                    <div className="input-group">
                      <input className="input-field" placeholder="teeMrenclave (0x + 64 hex)" value={mintMrenclave} onChange={e => setMintMrenclave(e.target.value)} />
                    </div>
                    <div className="input-group">
                      <input className="input-field" placeholder="teePublicKey (hex bytes)" value={mintPubKey} onChange={e => setMintPubKey(e.target.value)} />
                    </div>
                    {(localError || mintError) && (
                      <div className="info-box error">{(mintError as any)?.shortMessage ?? localError ?? String(mintError)}</div>
                    )}
                    <div className="agent-input-row">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={isMintPending || isMintConfirming}
                        onClick={handleMint}
                        style={{ flex: 1 }}
                      >
                        {isMintPending || isMintConfirming ? 'Minting…' : 'Mint NFA'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => { setShowMintForm(false); setLocalError(''); resetMint(); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ② PROJECT_TARGET */}
              <section>
                <div className="detail-section-label">
                  <span className="detail-section-number">②</span>
                  <span>PROJECT_TARGET</span>
                  <span className="detail-section-line" />
                </div>
                <div className="input-group">
                  <label className="input-label">CONTRACT_ADDR</label>
                  <input className="input-field" placeholder="0x..." value={contractAddr} onChange={e => setContractAddr(e.target.value as `0x${string}`)} />
                </div>
              </section>

              {/* ③ FUNDING_REQUEST */}
              <section>
                <div className="detail-section-label">
                  <span className="detail-section-number">③</span>
                  <span>FUNDING_REQUEST</span>
                  <span className="detail-section-line" />
                </div>
                <div className="agent-input-row" style={{ alignItems: 'center' }}>
                  <input className="input-field" type="number" min="0" step="0.001" placeholder="0.100" value={amount} onChange={e => setAmount(e.target.value)} style={{ maxWidth: 140 }} />
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>ETH</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>vault: {vaultBal} ETH avail</span>
                </div>
              </section>

              {/* ④ AVAILABLE_MATCHES */}
              <section>
                <div className="detail-section-label">
                  <span className="detail-section-number">④</span>
                  <span>AVAILABLE_MATCHES</span>
                  <span className="detail-section-line" />
                </div>

                {matches.length === 0 ? (
                  <div className="info-box" style={{ fontSize: 13 }}>
                    No open matches found. An admin can create demo matches with{' '}
                    <code style={{ color: '#00ff88' }}>scripts/create-matches.ts</code>.
                  </div>
                ) : (
                  <div className="asv-funding-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                    {matches.map(m => {
                      const selected = matchId === String(m.matchId);
                      return (
                        <div
                          key={m.matchId}
                          className="asv-funding-cell"
                          style={{
                            cursor: 'pointer',
                            borderColor: selected ? '#00ff88' : undefined,
                            background: selected ? 'rgba(0,255,136,0.06)' : undefined,
                          }}
                          onClick={() => {
                            setMatchId(String(m.matchId));
                            setOutcomeIndex('0');
                            setMinOdds(oddsString(m.homeOdds));
                            setDeadline(toDateTimeLocal(m.expiration));
                            setNonce(String(Math.floor(Math.random() * 1e12)));
                            if (!betAmount) setBetAmount('0.01');
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>
                            {m.home} <span style={{ opacity: 0.4 }}>vs</span> {m.away}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, fontSize: 12 }}>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              style={{ padding: '4px 6px', fontSize: 11 }}
                              onClick={e => {
                                e.stopPropagation();
                                setMatchId(String(m.matchId));
                                setOutcomeIndex('0');
                                setMinOdds(oddsString(m.homeOdds));
                                setDeadline(toDateTimeLocal(m.expiration));
                                setNonce(String(Math.floor(Math.random() * 1e12)));
                                if (!betAmount) setBetAmount('0.01');
                              }}
                            >
                              {m.home}<br/>{oddsString(m.homeOdds)}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              style={{ padding: '4px 6px', fontSize: 11 }}
                              onClick={e => {
                                e.stopPropagation();
                                setMatchId(String(m.matchId));
                                setOutcomeIndex('1');
                                setMinOdds(oddsString(m.drawOdds));
                                setDeadline(toDateTimeLocal(m.expiration));
                                setNonce(String(Math.floor(Math.random() * 1e12)));
                                if (!betAmount) setBetAmount('0.01');
                              }}
                            >
                              Draw<br/>{oddsString(m.drawOdds)}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              style={{ padding: '4px 6px', fontSize: 11 }}
                              onClick={e => {
                                e.stopPropagation();
                                setMatchId(String(m.matchId));
                                setOutcomeIndex('2');
                                setMinOdds(oddsString(m.awayOdds));
                                setDeadline(toDateTimeLocal(m.expiration));
                                setNonce(String(Math.floor(Math.random() * 1e12)));
                                if (!betAmount) setBetAmount('0.01');
                              }}
                            >
                              {m.away}<br/>{oddsString(m.awayOdds)}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ⑤ INIT_DATA */}
              <section>
                <div className="detail-section-label">
                  <span className="detail-section-number">⑤</span>
                  <span>INIT_DATA</span>
                  <span className="detail-section-line" />
                </div>
                <div className="input-group">
                  <label className="input-label">HEX CALLDATA</label>
                  <textarea
                    className="input-field"
                    rows={3}
                    placeholder="0x..."
                    value={initData}
                    onChange={e => {
                      const v = e.target.value.trim();
                      setInitData((v.startsWith('0x') ? v : `0x${v}`) as `0x${string}`);
                    }}
                    style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                  />
                </div>

                <div style={{ margin: '16px 0', fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>or build a WorldCup BetRequest</div>

                <div className="asv-funding-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 12 }}>
                  <div className="asv-funding-cell">
                    <span className="asv-funding-label">Match ID</span>
                    <input className="input-field" type="number" min="0" value={matchId} onChange={e => setMatchId(e.target.value)} />
                  </div>
                  <div className="asv-funding-cell">
                    <span className="asv-funding-label">Outcome</span>
                    <select className="input-field" value={outcomeIndex} onChange={e => setOutcomeIndex(e.target.value)}>
                      <option value="0">Home (0)</option>
                      <option value="1">Draw (1)</option>
                      <option value="2">Away (2)</option>
                    </select>
                  </div>
                  <div className="asv-funding-cell">
                    <span className="asv-funding-label">Bet Amount (ETH)</span>
                    <input className="input-field" type="number" min="0" step="0.001" value={betAmount} onChange={e => setBetAmount(e.target.value)} />
                  </div>
                  <div className="asv-funding-cell">
                    <span className="asv-funding-label">Min Odds (e.g. 1.8)</span>
                    <input className="input-field" type="number" min="0" step="0.01" value={minOdds} onChange={e => setMinOdds(e.target.value)} />
                  </div>
                  <div className="asv-funding-cell">
                    <span className="asv-funding-label">Deadline</span>
                    <input className="input-field" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
                  </div>
                  <div className="asv-funding-cell">
                    <span className="asv-funding-label">Nonce</span>
                    <input className="input-field" type="number" min="0" value={nonce} onChange={e => setNonce(e.target.value)} />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!encodedBetRequest || encodedBetRequest === '0x'}
                  onClick={applyEncodedBet}
                  style={{ marginBottom: 12 }}
                >
                  Apply Encoded BetRequest
                </button>
              </section>

              {/* Execute */}
              <section>
                {localError && <div className="info-box error" style={{ marginBottom: 12 }}>{localError}</div>}
                {state.error && <div className="info-box error" style={{ marginBottom: 12 }}>{(state.error as any)?.shortMessage ?? String(state.error)}</div>}
                <button
                  type="button"
                  className="btn-primary btn-full"
                  disabled={!canExecute}
                  onClick={handleExecute}
                >
                  {state.isPending || state.isConfirming ? (
                    <><span className="loading-spinner" /> Submitting…</>
                  ) : (
                    <>Submit Project →</>
                  )}
                </button>
                <div className="agent-footer-note">
                  submits to InvestmentManager.submitProject(contractAddr, requestedAmount, agentId, initData)
                </div>
              </section>

            </div>
          </div>

          <div className="agent-footer-note" style={{ color: 'rgba(255,255,255,0.12)' }}>
            NFA CONTRACT · {nfaAddress} · arb-sepolia
          </div>
        </main>
      </div>
    </>
  );
}
