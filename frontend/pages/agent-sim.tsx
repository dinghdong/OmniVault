'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
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
  const shortAddr = (a: string) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '';
  return (
    <pre className="agent-preview">
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
            onClick={() => { resetSubmit(); setCommitHash(''); setContractAddr(''); setBizApi(''); setAmount(''); setHashLabel(''); }}
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
                    {(['did', 'repo', 'endpoint', 'model'] as const).map(k => (
                      <div key={k} className="agent-terminal-row">
                        <span style={{ color: 'rgba(255,255,255,0.15)' }}>{'> '}</span>
                        <span className="agent-terminal-key">{k.padEnd(8)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.15)' }}>:</span>
                        <span className="agent-terminal-value" style={{ color: selected.color, opacity: 0.9 }}>{(selected as any)[k] || '—'}</span>
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
                  <input className="input-field" placeholder="0x..." value={contractAddr} onChange={e => setContractAddr(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">COMMIT_HASH</label>
                  <div className="agent-input-row">
                    <input className="input-field" placeholder="0x... (paste or drop file)" value={commitHash} onChange={e => { setCommitHash(e.target.value); setHashLabel(''); }} />
                    <div
                      className={`agent-drop-zone ${dragging ? 'dragging' : ''}`}
                      onClick={() => fileRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v6M3 5l3 3 3-3M1.5 10h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>{hashLabel || 'hash file'}</span>
                    </div>
                    <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                  </div>
                  {commitHash && <div className="agent-hash-ok">✓ {commitHash.slice(0, 24)}…</div>}
                </div>
                <div className="input-group">
                  <label className="input-label">BIZ_API <span style={{ opacity: 0.5 }}>(optional)</span></label>
                  <input className="input-field" placeholder="https://github.com/org/project" value={bizApi} onChange={e => setBizApi(e.target.value)} />
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

              {/* ④ CALLDATA_PREVIEW */}
              <section>
                <div className="detail-section-label">
                  <span className="detail-section-number">④</span>
                  <span>CALLDATA_PREVIEW</span>
                  <div className="agent-preview-live" />
                  <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>live</span>
                  <span className="detail-section-line" />
                </div>
                <CalldataPreview
                  commitHash={commitHash}
                  contractAddr={contractAddr}
                  bizApi={bizApi}
                  amount={amount}
                  agentDid={selected?.did ?? ''}
                  agentRepo={selected?.repo ?? ''}
                  agentEndpoint={selected?.apiEndpoint ?? ''}
                  imAddr={investmentManagerAddress}
                />
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
                    <><span className="loading-spinner" /> Executing…</>
                  ) : (
                    <>Execute Transaction →</>
                  )}
                </button>
                <div className="agent-footer-note">
                  equivalent to: npx hardhat run scripts/demo-agent.ts --network arbitrumSepolia
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
