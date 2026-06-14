'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import Head from 'next/head';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { nfaAddress, nfaAbi, fundVaultAddress, fundVaultAbi, investmentManagerAddress, investmentManagerAbi, contractChainId } from '../hooks/contracts';
import { useProjectSubmit } from '../hooks/useProjectSubmit';

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

/* ─── Live calldata preview ──────────────────────────────────────────────── */
function CalldataPreview({ commitHash, contractAddr, bizApi, amount, agentDid, agentRepo, agentEndpoint, imAddr }: {
  commitHash: string; contractAddr: string; bizApi: string; amount: string;
  agentDid: string; agentRepo: string; agentEndpoint: string; imAddr: string;
}) {
  const C = { fn: '#00ff88', param: '#8b949e', filled: '#e6edf3', empty: '#f87171', paren: '#6e7681', str: '#a5d6ff', num: '#f2cc60', comment: '#3d444d', arrow: '#63b3ed' };
  type VType = 'bytes32' | 'addr' | 'str' | 'num';
  const V = (v: string, type: VType, note?: string) => {
    const empty = !v || v === '0x' || v === '0';
    const color = empty ? C.empty : type === 'str' ? C.str : type === 'num' ? C.num : C.filled;
    const display = empty ? (type === 'addr' ? '0x__________' : type === 'bytes32' ? '0x______________' : '""') : (type === 'str' ? `"${v}"` : v);
    return <span><span style={{ color }}>{display}</span>{note && <span style={{ color: C.arrow, marginLeft: 8, fontSize: 10 }}>← {note}</span>}</span>;
  };
  const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };
  const shortAddr = (a: string) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '';
  return (
    <pre style={{ ...mono, margin: 0, padding: '14px 16px', background: '#010409', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflowX: 'auto', fontSize: 12, lineHeight: '1.9', color: C.filled }}>
      <span style={{ color: C.comment }}>{`// InvestmentManager · ${shortAddr(imAddr)}`}</span>{'\n'}
      <span style={{ color: C.fn }}>im</span><span style={{ color: C.paren }}>.</span><span style={{ color: C.fn }}>submitProject</span><span style={{ color: C.paren }}>{'('}</span>{'\n'}
      {'  '}<span style={{ color: C.param }}>commitHash      </span><span style={{ color: C.paren }}>: </span>{V(commitHash, 'bytes32', commitHash ? 'sha256 of file' : 'required')},{'\n'}
      {'  '}<span style={{ color: C.param }}>contractAddr    </span><span style={{ color: C.paren }}>: </span>{V(contractAddr, 'addr', !contractAddr ? 'required' : '')},{'\n'}
      {'  '}<span style={{ color: C.param }}>bizApi          </span><span style={{ color: C.paren }}>: </span>{V(bizApi, 'str')},{'\n'}
      {'  '}<span style={{ color: C.param }}>requestedAmount </span><span style={{ color: C.paren }}>: </span>{V(amount ? `${amount} ether` : '', 'num', !amount ? 'required' : '')},{'\n'}
      {'  '}<span style={{ color: C.param }}>agentDid        </span><span style={{ color: C.paren }}>: </span>{V(agentDid, 'str', agentDid ? 'from NFA ✓' : 'select NFA')},{'\n'}
      {'  '}<span style={{ color: C.param }}>agentRepo       </span><span style={{ color: C.paren }}>: </span>{V(agentRepo, 'str', agentRepo ? 'from NFA ✓' : '')},{'\n'}
      {'  '}<span style={{ color: C.param }}>agentApiEndpoint</span><span style={{ color: C.paren }}>: </span>{V(agentEndpoint, 'str', agentEndpoint ? 'from NFA ✓' : '')}{'\n'}
      <span style={{ color: C.paren }}>{')'}</span>
    </pre>
  );
}

function SectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em' }}>
      <span style={{ color: '#00ff88' }}>{num}</span>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
    </div>
  );
}

const AGENT_COLORS = ['#00ff88', '#63b3ed', '#a78bfa', '#f97316', '#f2cc60'];

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function AgentSimPage() {
  const { address } = useAccount();
  const { submit, state, reset: resetSubmit } = useProjectSubmit();

  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [contractAddr, setContractAddr] = useState('');
  const [commitHash, setCommitHash]   = useState('');
  const [hashLabel, setHashLabel]     = useState('');
  const [bizApi, setBizApi]           = useState('');
  const [amount, setAmount]           = useState('');
  const [dragging, setDragging]       = useState(false);
  const [localError, setLocalError]   = useState('');
  const [showMintForm, setShowMintForm] = useState(false);
  const [mintRepo, setMintRepo]       = useState('');
  const [mintApi, setMintApi]         = useState('');
  const [mintModel, setMintModel]     = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
    setLocalError('');
    writeMint({
      address: nfaAddress,
      abi: nfaAbi,
      functionName: 'mint',
      args: [mintRepo.trim(), mintApi.trim(), mintModel.trim()],
      chainId: contractChainId,
      account: address,
    } as any);
  }, [writeMint, address, mintRepo, mintApi, mintModel]);

  useEffect(() => {
    if (isMintConfirmed) {
      setShowMintForm(false);
      setMintRepo('');
      setMintApi('');
      setMintModel('');
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

  const { data: agentDids } = useReadContracts({
    contracts: ids.map(id => ({ address: nfaAddress, abi: nfaAbi, functionName: 'getDid' as const, args: [id] as const, chainId: contractChainId })),
    query: { enabled: ids.length > 0 },
  });

  const { data: vaultBalRaw } = useReadContract({
    address: fundVaultAddress, abi: fundVaultAbi, functionName: 'vaultBalance',
    chainId: contractChainId,
    query: { refetchInterval: 15_000 },
  });

  const vaultBal = vaultBalRaw ? parseFloat(formatEther(vaultBalRaw as bigint)).toFixed(4) : '—';

  // Build agent list
  const agents = ids.map((id, i) => {
    const meta = agentMetas?.[i]?.status === 'success' ? (agentMetas[i].result as any) : null;
    const did  = agentDids?.[i]?.status  === 'success' ? (agentDids[i].result  as string) : '';
    return {
      id: Number(id),
      did,
      repo:        meta?.repo        ?? '',
      apiEndpoint: meta?.apiEndpoint ?? '',
      model:       meta?.model       ?? '',
      color: AGENT_COLORS[i % AGENT_COLORS.length],
    };
  });

  const selected = agents.find(a => a.id === selectedId) ?? null;

  // ── File hash ──────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    const buf    = await f.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex    = '0x' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    setCommitHash(hex);
    setHashLabel(f.name);
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const canExecute = !!selected && !!contractAddr && !!commitHash && !!amount && parseFloat(amount) > 0 && !state.isPending && !state.isConfirming;

  const handleExecute = async () => {
    setLocalError('');
    if (!address)     { setLocalError('Connect wallet first.'); return; }
    if (!selected)    { setLocalError('Select an NFA agent.'); return; }
    if (!commitHash)  { setLocalError('Provide or hash a commit.'); return; }
    if (!contractAddr){ setLocalError('Enter target contract address.'); return; }
    if (!amount || parseFloat(amount) <= 0) { setLocalError('Enter funding amount.'); return; }
    try {
      const { parseEther } = await import('viem');
      submit(
        commitHash as `0x${string}`,
        contractAddr as `0x${string}`,
        bizApi.trim(),
        parseEther(amount as `${number}`),
        selected.did,
        selected.repo,
        selected.apiEndpoint,
      );
    } catch (e: any) { setLocalError(e?.message ?? 'Execute failed'); }
  };

  const monoInput: React.CSSProperties = {
    width: '100%', background: '#010409', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 6, padding: '9px 12px', color: 'rgba(255,255,255,0.85)',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12,
    outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
  };

  const fieldLabel = (text: string, optional = false) => (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.28)', marginBottom: 5, letterSpacing: '0.1em' }}>
      {text}{optional && <span style={{ opacity: 0.5 }}> (optional)</span>}
    </div>
  );

  // After confirmed
  if (state.isConfirmed && state.projectId !== null) {
    return (
      <div style={{ minHeight: '100vh', background: '#08090d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
        <div style={{ textAlign: 'center', color: '#00ff88' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Project #{state.projectId} submitted</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>{state.hash?.slice(0, 20)}…</div>
          <button onClick={() => { resetSubmit(); setCommitHash(''); setContractAddr(''); setBizApi(''); setAmount(''); setHashLabel(''); }}
            style={{ padding: '10px 24px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', borderRadius: 8, color: '#00ff88', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
            ← New Simulation
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Agent Simulator — OmniVault DevTool</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Syne:wght@500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #08090d; color: rgba(255,255,255,0.85); }
        .mono-in:focus { border-color: rgba(0,255,136,0.35) !important; }
        .mono-in::placeholder { color: rgba(255,255,255,0.18); }
        .nfa-pill { cursor: pointer; transition: all 0.15s; }
        .nfa-pill:hover { background: rgba(255,255,255,0.04) !important; }
        .exec-btn { transition: all 0.2s; }
        .exec-btn:hover:not(:disabled) { background: #00ff88 !important; color: #08090d !important; box-shadow: 0 0 28px rgba(0,255,136,0.3) !important; transform: translateY(-1px); }
        .exec-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .drop-zone:hover { border-color: rgba(0,255,136,0.3) !important; }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes fadein { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        .nfa-terminal { animation: fadein 0.2s ease; }
      `}</style>

      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>

          <div style={{ marginBottom: 28, display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <a href="/" style={{ color: 'rgba(255,255,255,0.25)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textDecoration: 'none', marginRight: 4 }}>← OmniVault</a>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>Agent Simulator</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>manually execute im.submitProject()</span>
          </div>

          <div style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>

            {/* Title bar */}
            <div style={{ padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {['#f87171','#f2cc60','#00ff88'].map((c, i) => <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.6 }} />)}
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 4 }}>omnivault — agent_simulator.ts</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {[['DEVTOOL', '#00ff88', 'rgba(0,255,136,0.08)', 'rgba(0,255,136,0.2)'], ['arb-sepolia', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.07)']].map(([t, c, bg, br]) => (
                  <span key={t} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.12em', color: c, background: bg, border: `1px solid ${br}`, padding: '2px 7px', borderRadius: 4 }}>{t}</span>
                ))}
              </div>
            </div>

            <div style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 26 }}>

              {/* ① AGENT_IDENTITY */}
              <section>
                <SectionLabel num="①" label="AGENT_IDENTITY" />

                {!address ? (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '12px 0' }}>
                    Connect wallet to view your NFA tokens →{' '}
                    <a href="/" style={{ color: '#00ff88', textDecoration: 'none' }}>Connect</a>
                  </div>
                ) : agents.length === 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '8px 0' }}>
                      No NFA tokens found for {address.slice(0,8)}…
                    </div>
                    <div
                      className="nfa-pill"
                      onClick={() => setShowMintForm(true)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1px dashed rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.35)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, cursor: 'pointer' }}
                    >
                      <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Mint Agent Identity
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: selected ? 10 : 0 }}>
                    {agents.map(agent => {
                      const sel = selectedId === agent.id;
                      return (
                        <div key={agent.id} className="nfa-pill"
                          onClick={() => setSelectedId(sel ? null : agent.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px 7px 8px', borderRadius: 9, background: sel ? `${agent.color}12` : 'rgba(255,255,255,0.03)', border: `1px solid ${sel ? agent.color + '50' : 'rgba(255,255,255,0.07)'}`, boxShadow: sel ? `0 0 16px ${agent.color}18` : 'none' }}>
                          <AgentAvatar id={agent.id} color={agent.color} />
                          <div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: sel ? agent.color : 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
                              Agent #{String(agent.id).padStart(3, '0')}
                            </div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>{agent.model || '—'}</div>
                          </div>
                          {sel && <div style={{ width: 5, height: 5, borderRadius: '50%', background: agent.color, marginLeft: 2, boxShadow: `0 0 8px ${agent.color}`, animation: 'blink 2s infinite' }} />}
                        </div>
                      );
                    })}
                    <div
                      className="nfa-pill"
                      onClick={() => setShowMintForm(true)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1px dashed rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.3)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, cursor: 'pointer' }}
                    >
                      <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Mint
                    </div>
                  </div>
                )}

                {selected && (
                  <div className="nfa-terminal" style={{ background: '#010409', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `2px solid ${selected.color}50`, borderRadius: '0 6px 6px 0', padding: '10px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.95 }}>
                    {([['did', selected.did], ['repo', selected.repo], ['endpoint', selected.apiEndpoint], ['model', selected.model]] as [string,string][]).map(([k, v]) => (
                      <div key={k}>
                        <span style={{ color: 'rgba(255,255,255,0.18)' }}>{'> '}</span>
                        <span style={{ color: '#8b949e' }}>{k.padEnd(8)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.18)' }}>: </span>
                        <span style={{ color: selected.color, opacity: 0.85, wordBreak: 'break-all' }}>{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mint NFA form */}
                {showMintForm && (
                  <div className="nfa-terminal" style={{ marginTop: 12, background: '#010409', border: '1px solid rgba(0,255,136,0.15)', borderRadius: 6, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#00ff88', letterSpacing: '0.1em' }}>MINT NEW NFA IDENTITY</div>
                    <input className="mono-in" style={monoInput} placeholder="Repo URL" value={mintRepo} onChange={e => setMintRepo(e.target.value)} />
                    <input className="mono-in" style={monoInput} placeholder="API Endpoint" value={mintApi} onChange={e => setMintApi(e.target.value)} />
                    <input className="mono-in" style={monoInput} placeholder="Model (e.g. claude-3.5-sonnet)" value={mintModel} onChange={e => setMintModel(e.target.value)} />
                    {(localError || mintError) && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#f87171', padding: '6px 8px', background: 'rgba(248,113,113,0.08)', borderRadius: 4 }}>
                        {(mintError as any)?.shortMessage ?? localError ?? String(mintError)}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="exec-btn"
                        disabled={isMintPending || isMintConfirming}
                        onClick={handleMint}
                        style={{ flex: 1, padding: '10px 14px', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.25)', borderRadius: 6, color: '#00ff88', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, cursor: 'pointer' }}
                      >
                        {isMintPending || isMintConfirming ? 'Minting…' : 'Mint NFA'}
                      </button>
                      <button
                        onClick={() => { setShowMintForm(false); setLocalError(''); resetMint(); }}
                        style={{ padding: '10px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: 'rgba(255,255,255,0.4)', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ② PROJECT_TARGET */}
              <section>
                <SectionLabel num="②" label="PROJECT_TARGET" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    {fieldLabel('CONTRACT_ADDR')}
                    <input className="mono-in" style={monoInput} placeholder="0x..." value={contractAddr} onChange={e => setContractAddr(e.target.value)} />
                  </div>
                  <div>
                    {fieldLabel('COMMIT_HASH')}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="mono-in" style={{ ...monoInput, flex: 1, width: 'auto' }} placeholder="0x... (paste or drop file)" value={commitHash} onChange={e => { setCommitHash(e.target.value); setHashLabel(''); }} />
                      <div className="drop-zone" onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                        style={{ flexShrink: 0, padding: '9px 11px', background: dragging ? 'rgba(0,255,136,0.06)' : '#010409', border: `1px dashed ${dragging ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v6M3 5l3 3 3-3M1.5 10h9" stroke="rgba(255,255,255,0.35)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>{hashLabel || 'hash file'}</span>
                      </div>
                      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    </div>
                    {commitHash && <div style={{ marginTop: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#00ff88', opacity: 0.6 }}>✓ {commitHash.slice(0, 24)}…</div>}
                  </div>
                  <div>
                    {fieldLabel('BIZ_API', true)}
                    <input className="mono-in" style={{ ...monoInput, fontFamily: 'inherit', fontSize: 12 }} placeholder="https://github.com/org/project" value={bizApi} onChange={e => setBizApi(e.target.value)} />
                  </div>
                </div>
              </section>

              {/* ③ FUNDING_REQUEST */}
              <section>
                <SectionLabel num="③" label="FUNDING_REQUEST" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input className="mono-in" style={{ ...monoInput, width: 130 }} type="number" min="0" step="0.001" placeholder="0.100" value={amount} onChange={e => setAmount(e.target.value)} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>ETH</span>
                  <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>vault: {vaultBal} ETH avail</span>
                </div>
              </section>

              {/* ④ CALLDATA_PREVIEW */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em' }}>
                  <span style={{ color: '#00ff88' }}>④</span>
                  <span style={{ color: 'rgba(255,255,255,0.25)' }}>CALLDATA_PREVIEW</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff88', animation: 'blink 1.8s infinite' }} />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)' }}>live</span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
                </div>
                <CalldataPreview commitHash={commitHash} contractAddr={contractAddr} bizApi={bizApi} amount={amount} agentDid={selected?.did ?? ''} agentRepo={selected?.repo ?? ''} agentEndpoint={selected?.apiEndpoint ?? ''} imAddr={investmentManagerAddress} />
              </section>

              {/* Execute */}
              <section>
                {localError && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#f87171', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6 }}>{localError}</div>}
                {state.error && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#f87171', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6 }}>{(state.error as any)?.shortMessage ?? String(state.error)}</div>}
                <button className="exec-btn" disabled={!canExecute} onClick={handleExecute}
                  style={{ width: '100%', padding: '13px 16px', background: canExecute ? 'rgba(0,255,136,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${canExecute ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, color: canExecute ? '#00ff88' : 'rgba(255,255,255,0.25)', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 500, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {state.isPending || state.isConfirming ? (
                    <><div className="asv-spinner-sm" style={{ width: 14, height: 14, borderWidth: 2 }} />Executing…</>
                  ) : (
                    <><span>Execute Transaction</span><span style={{ fontSize: 16 }}>→</span></>
                  )}
                </button>
                <div style={{ marginTop: 9, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.03em', lineHeight: 1.6 }}>
                  equivalent to:{' '}<span style={{ color: 'rgba(255,255,255,0.32)' }}>npx hardhat run scripts/demo-agent.ts --network arbitrumSepolia</span>
                </div>
              </section>

            </div>
          </div>

          <div style={{ marginTop: 16, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.08em' }}>
            NFA CONTRACT · {nfaAddress} · arb-sepolia
          </div>
        </div>
      </div>
    </>
  );
}
