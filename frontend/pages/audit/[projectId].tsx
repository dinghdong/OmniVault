'use client';
import { useRouter } from 'next/router';
import { useChainId } from 'wagmi';
import Head from 'next/head';
import Link from 'next/link';
import AuditStatusView from '../../components/AuditStatusView';

export default function AuditPage() {
  const router = useRouter();
  const chainId = useChainId();
  const { projectId: rawId } = router.query;
  const projectId = rawId ? parseInt(rawId as string, 10) : null;

  return (
    <>
      <Head>
        <title>AI Audit — Project #{projectId} · OmniVault</title>
      </Head>

      <div className="audit-page">
        {/* ── Top nav ── */}
        <header className="audit-page-header">
          <Link href="/#pipeline" className="audit-back-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to Pipeline
          </Link>

          <div className="audit-page-title">
            <span className="audit-page-title-label">AI Audit Report</span>
            {projectId && <span className="audit-page-title-id">Project #{projectId}</span>}
          </div>
        </header>

        {/* ── Content ── */}
        <main className="audit-page-main">
          {!projectId ? (
            <div className="audit-page-empty">Invalid project ID</div>
          ) : (
            <AuditStatusView
              projectId={projectId}
              txHash={undefined}
              chainId={chainId}
              onDone={() => router.push('/#pipeline')}
            />
          )}
        </main>
      </div>
    </>
  );
}
