'use client';
import { useRouter } from 'next/router';
import { useChainId } from 'wagmi';
import Head from 'next/head';
import AuditStatusView from '../../components/AuditStatusView';
import PageHeader from '../../components/PageHeader';

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

      <div className="detail-page">
        <PageHeader
          backHref="/#pipeline"
          backLabel="Back to Pipeline"
          label="AI Audit Report"
          title={projectId ? `Project #${projectId}` : 'Project'}
        />

        <main className="detail-page-main">
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
