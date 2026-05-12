'use client';
import { useState, useRef, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { keccak256 } from 'viem';
import { useProjectSubmit } from '../hooks/useProjectSubmit';
import TxStatus from './TxStatus';

// Compute keccak256 of a file's raw bytes (client-side, no upload needed)
async function hashFile(file: File): Promise<`0x${string}`> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return keccak256(bytes);
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
        accept=".pdf,.pptx,.ppt,.key,.doc,.docx"
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
            <span className="upload-filesize">{(file.size / 1024).toFixed(0)} KB — click to replace</span>
          </div>
        </div>
      ) : (
        <div className="upload-prompt">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity="0.5">
            <path d="M14 5v13M8 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 22h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="upload-label">Drop your pitch deck here</span>
          <span className="upload-sub">PDF, PPTX, Keynote, Word · click to browse</span>
        </div>
      )}
    </div>
  );
}

export default function ApplyModal() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { submit, state, reset } = useProjectSubmit();

  const [file, setFile]         = useState<File | null>(null);
  const [deckUrl, setDeckUrl]   = useState('');
  const [hashing, setHashing]   = useState(false);

  const isActive = state.isPending || state.isConfirming || state.isConfirmed || !!state.error;
  const canSubmit = !!address && !!file && deckUrl.trim().length > 4 && !hashing && !isActive;

  const handleFile = (f: File) => setFile(f);

  const handleSubmit = async () => {
    if (!canSubmit || !file || !address) return;
    setHashing(true);
    try {
      const commitHash = await hashFile(file);
      // contractAddr = applicant's wallet address (identity anchor, no contract required yet)
      submit(commitHash, address, deckUrl.trim());
    } finally {
      setHashing(false);
    }
  };

  const handleReset = () => {
    reset();
    setFile(null);
    setDeckUrl('');
  };

  if (isActive) {
    return (
      <TxStatus
        state={{ ...state, isLoading: state.isPending || state.isConfirming }}
        chainId={chainId}
        onReset={handleReset}
        label="Application Submitted"
      />
    );
  }

  return (
    <div className="action-form apply-form">
      <div className="apply-intro">
        Upload your pitch deck. OmniVault's AI agents will analyze your business model,
        market opportunity, and team — no technical jargon required.
      </div>

      {/* Step 1: upload */}
      <div className="apply-step">
        <div className="apply-step-num">1</div>
        <div className="apply-step-body">
          <div className="apply-label">Pitch Deck</div>
          <UploadZone file={file} onFile={handleFile} disabled={isActive} />
          {file && (
            <div className="apply-hash-note">
              File fingerprint will be recorded on-chain for authenticity proof.
            </div>
          )}
        </div>
      </div>

      {/* Step 2: public link */}
      <div className="apply-step">
        <div className="apply-step-num">2</div>
        <div className="apply-step-body">
          <div className="apply-label">Public Deck Link</div>
          <input
            className="input-field"
            placeholder="Google Drive, Notion, Dropbox, IPFS…"
            value={deckUrl}
            onChange={e => setDeckUrl(e.target.value)}
            disabled={isActive}
          />
          <div className="apply-hint" style={{ marginTop: 4 }}>
            AI agents will fetch this URL to run the audit. Make sure it's publicly accessible.
          </div>
        </div>
      </div>

      <button
        className="btn-primary btn-full"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {hashing ? 'Hashing file…' : 'Submit for AI Audit →'}
      </button>

      {!address && (
        <div className="wallet-warning">Connect your wallet to apply</div>
      )}
    </div>
  );
}
