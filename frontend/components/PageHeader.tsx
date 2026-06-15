import Link from 'next/link';

interface PageHeaderProps {
  backHref: string;
  backLabel: string;
  label: string;
  title: string;
  badge?: string;
  badgePulse?: boolean;
}

export default function PageHeader({
  backHref,
  backLabel,
  label,
  title,
  badge,
  badgePulse = false,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <Link href={backHref} className="page-header-back">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {backLabel}
      </Link>

      <div className="page-header-title-block">
        <div className="page-header-label">{label}</div>
        <h1 className="page-header-title">{title}</h1>
      </div>

      {badge ? (
        <div className={`page-header-badge ${badgePulse ? 'pulse' : ''}`}>
          {badgePulse && <span className="page-header-badge-dot" />}
          {badge}
        </div>
      ) : (
        <div className="page-header-spacer" />
      )}
    </header>
  );
}
