'use client';
import { useState, useRef, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { keccak256, parseEther } from 'viem';
import { useProjectSubmit } from '../hooks/useProjectSubmit';
import { contractChainId } from '../hooks/contracts';
import TxStatus from './TxStatus';
import AuditStatusView from './AuditStatusView';

async function hashFile(file: File): Promise<`0x${string}`> {
  const buf = await file.arrayBuffer();
  return keccak256(new Uint8Array(buf));
}

function UploadZone({
  file, onFile, disabled,
}: { file: File | null; onFile: (f: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      className={`upload-zone ${dragging ? 'upload-zone--drag' : ''} ${file ? 'upload-zone--done' : ''} ${disabled ? 'upload-zone--disabled' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.pptx,.ppt,.key,.doc,.docx,.txt,.md"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {file ? (
        <div className="upload-done">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="10" stroke="#00ff88" strokeWidth="1.5"/>
            <path d="M6 11l3.5 3.5L16 7" stroke="#00ff88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="upload-file-info">
            <span className="upload-filename">{file.name}</span>
            <span className="upload-filesize">{(file.size / 1024).toFixed(0)} KB · click to replace</span>
          </div>
        </div>
      ) : (
        <div className="upload-prompt">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity="0.5">
            <path d="M14 5v13M8 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 22h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="upload-label">Drop your pitch deck here</span>
          <span className="upload-sub">PDF, PPTX, Keynote, Word, Markdown · click to browse</span>
        </div>
      )}
    </div>
  );
}

type Step = 'idle' | 'hashing' | 'uploading-0g' | 'submitting';

export default function ApplyModal() {
  const { address } = useAccount();
  const chainId     = useChainId();
  const { submit, state, reset } = useProjectSubmit();

  const [file, setFile]                   = useState<File | null>(null);
  const [requestedEth, setRequestedEth]   = useState('');
  const [projectInfo, setProjectInfo]     = useState('');
  const [commitHash, setCommitHash]       = useState<`0x${string}` | null>(null);
  const [zgRootHash, setZgRootHash]       = useState<`0x${string}` | null>(null);
  const [zgTxHash, setZgTxHash]           = useState<string | null>(null);
  const [zgUploaded, setZgUploaded]       = useState(false);
  const [step, setStep]                   = useState<Step>('idle');
  const [localError, setLocalError]       = useState<string | null>(null);

  const isWrongChain  = !!address && chainId !== contractChainId;
  const isTransacting = state.isPending || state.isConfirming;
  const hasError      = !!state.error;
  const isConfirmed   = state.isConfirmed;
  const reqEthNum     = parseFloat(requestedEth);
  const busy          = step !== 'idle' || isTransacting || isConfirmed;
  const canSubmit     = !!address && !isWrongChain && !!file
                        && requestedEth.trim().length > 0 && reqEthNum > 0
                        && !busy;

  const handleFile = async (f: File) => {
    setFile(f);
    setCommitHash(null);
    setZgRootHash(null);
    setZgTxHash(null);
    setZgUploaded(false);
    // Pre-compute keccak256 fingerprint for immediate UX feedback
    const h = await hashFile(f);
    setCommitHash(h);
  };

  const handleSubmit = async () => {
    setLocalError(null);
    if (!address)                              { setLocalError('Connect your wallet first.'); return; }
    if (isWrongChain)                          { setLocalError(`Switch to Ethereum Sepolia (chainId ${contractChainId}).`); return; }
    if (!file)                                 { setLocalError('Upload your pitch deck.'); return; }
    if (!requestedEth || reqEthNum <= 0)       { setLocalError('Enter a valid funding request in ETH.'); return; }
    if (busy) return;

    try {
      // 1. Ensure keccak256 fingerprint is ready
      setStep('hashing');
      const keccakHash = commitHash ?? (await hashFile(file));

      // 2. Upload to 0G Storage — compute Merkle root (and optionally submit to network)
      setStep('uploading-0g');
      let onChainHash: `0x${string}` = keccakHash;
      try {
        const buf    = await file.arrayBuffer();
        const b64    = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const resp   = await fetch('/api/upload-to-0g', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data: b64, name: file.name }),
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.rootHash) {
            onChainHash = result.rootHash as `0x${string}`;
            setZgRootHash(result.rootHash);
            setZgUploaded(!!result.uploaded);
            if (result.txHash) setZgTxHash(result.txHash);
          }
        } else {
          console.warn('[0G Upload] API error, falling back to keccak256:', await resp.text());
        }
      } catch (zgErr: any) {
        console.warn('[0G Upload] Failed, falling back to keccak256:', zgErr?.message);
        // Non-fatal: use keccak256 hash if 0G upload fails
      }

      // 3. Submit on-chain — use 0G Merkle root (or keccak256 fallback) as commitHash
      setStep('submitting');
      const reqWei = parseEther(requestedEth.trim() as `${number}`);
      submit(onChainHash, address, projectInfo.trim(), reqWei);
    } catch (err: any) {
      setLocalError(err?.message || 'Submission failed');
    } finally {
      setStep('idle');
    }
  };

  const handleReset = () => {
    reset();
    setFile(null);
    setRequestedEth('');
    setProjectInfo('');
    setCommitHash(null);
    setZgRootHash(null);
    setZgTxHash(null);
    setZgUploaded(false);
    setLocalError(null);
    setStep('idle');
  };

  const submitLabel = () => {
    if (step === 'hashing')                     return 'Computing fingerprint…';
    if (step === 'uploading-0g')                return 'Uploading to 0G Storage…';
    if (step === 'submitting' || isTransacting) return 'Submitting…';
    return 'Submit for AI Audit →';
  };

  // ── After confirmed: show audit tracker ──────────────────────────────────
  if (isConfirmed && state.projectId !== null) {
    return (
      <AuditStatusView
        projectId={state.projectId}
        txHash={state.hash}
        chainId={chainId}
        onDone={handleReset}
      />
    );
  }

  // ── During tx: show TxStatus ──────────────────────────────────────────────
  if (isTransacting || hasError) {
    return (
      <TxStatus
        state={{ ...state, isLoading: isTransacting }}
        chainId={chainId}
        onReset={handleReset}
        label="Application Submitted"
      />
    );
  }

  if (isConfirmed && state.projectId === null) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'rgba(255,255,255,0.6)' }}>
        <div className="asv-spinner-sm" style={{ margin: '0 auto 1rem' }} />
        Parsing project ID from transaction…
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="action-form apply-form">
      <div className="apply-intro">
        Upload your pitch deck. The AI audit runs via{' '}
        <strong>Chainlink Functions</strong> calling <strong>0G Compute</strong> — three rounds
        of verifiable inference, result committed on-chain.
      </div>

      {isWrongChain && (
        <div className="apply-warning">
          ⚠ Switch MetaMask to <strong>Ethereum Sepolia</strong> (chainId {contractChainId}) before submitting.
        </div>
      )}

      {/* Step 1: Pitch Deck */}
      <div className="apply-step">
        <div className="apply-step-num">1</div>
        <div className="apply-step-body">
          <div className="apply-label">Pitch Deck</div>
          <UploadZone file={file} onFile={handleFile} disabled={busy} />
          {commitHash && !zgRootHash && (
            <div className="apply-hint" style={{ marginTop: 6 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ display: 'inline', marginRight: 4 }}>
                <path d="M6 1L1 3.5v2.5c0 2.76 2.22 5.34 5 5.83 2.78-.49 5-3.07 5-5.83V3.5L6 1z" stroke="#00ff88" strokeWidth="1" fill="none"/>
                <path d="M3.5 6l1.5 1.5L8.5 4" stroke="#00ff88" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              keccak256 fingerprint:&nbsp;
              <code style={{ fontSize: 10, opacity: 0.7 }}>{commitHash.slice(0, 18)}…</code>
            </div>
          )}
          {zgRootHash && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1L1 3.5v2.5c0 2.76 2.22 5.34 5 5.83 2.78-.49 5-3.07 5-5.83V3.5L6 1z" stroke="#00ff88" strokeWidth="1" fill="none"/>
                  <path d="M3.5 6l1.5 1.5L8.5 4" stroke="#00ff88" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 11, color: '#00ff88', fontWeight: 600 }}>
                  0G Storage Merkle Root
                </span>
                {zgUploaded && (
                  <span style={{ fontSize: 10, color: '#00ff88', opacity: 0.7, marginLeft: 4 }}>✓ Uploaded to network</span>
                )}
              </div>
              <code style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', wordBreak: 'break-all' }}>
                {zgRootHash}
              </code>
              {zgTxHash && (
                <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                  0G tx: <code style={{ color: 'rgba(0,255,136,0.7)' }}>{zgTxHash.slice(0, 16)}…</code>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Project Info (AI context) */}
      <div className="apply-step">
        <div className="apply-step-num">2</div>
        <div className="apply-step-body">
          <div className="apply-label">Project Info <span style={{ opacity: 0.45, fontWeight: 400 }}>(optional)</span></div>
          <textarea
            className="input-field"
            rows={3}
            placeholder="GitHub URL, project description, or any context for the AI audit…"
            value={projectInfo}
            onChange={e => setProjectInfo(e.target.value)}
            disabled={busy}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
          />
          <div className="apply-hint" style={{ marginTop: 4 }}>
            Passed directly to the Chainlink Functions AI audit as additional context.
          </div>
        </div>
      </div>

      {/* Step 3: Funding Request */}
      <div className="apply-step">
        <div className="apply-step-num">3</div>
        <div className="apply-step-body">
          <div className="apply-label">Funding Request (ETH)</div>
          <div className="apply-amount-row">
            <input
              className="input-field apply-amount-input"
              type="number"
              min="0"
              step="0.001"
              placeholder="0.1"
              value={requestedEth}
              onChange={e => { setRequestedEth(e.target.value); setLocalError(null); }}
              disabled={busy}
            />
            <span className="apply-amount-unit">ETH</span>
          </div>
          <div className="apply-hint" style={{ marginTop: 4 }}>
            20% released upfront · 80% vests linearly over 52 weeks on-chain.
          </div>
        </div>
      </div>

      {/* Progress indicator */}
      {(step === 'hashing' || step === 'uploading-0g') && (
        <div className="apply-upload-progress">
          <div className="asv-spinner-sm" style={{ flexShrink: 0 }} />
          <span>
            {step === 'hashing'
              ? 'Computing file fingerprint…'
              : 'Uploading to 0G Storage — computing Merkle tree…'}
          </span>
        </div>
      )}

      {localError && (
        <div className="apply-error">{localError}</div>
      )}

      <button
        className="btn-primary btn-full"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitLabel()}
      </button>

      {!address && (
        <div className="wallet-warning">Connect your wallet to apply</div>
      )}
    </div>
  );
}
