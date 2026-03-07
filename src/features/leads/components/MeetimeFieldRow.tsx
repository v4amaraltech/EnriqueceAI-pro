import type { ReactNode } from 'react';

interface MeetimeFieldRowProps {
  label: string;
  value: string | ReactNode;
  href?: string;
  mono?: boolean;
}

export function MeetimeFieldRow({ label, value, href, mono }: MeetimeFieldRowProps) {
  const content = href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline truncate">
      {value}
    </a>
  ) : (
    <span className={`truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
  );

  return (
    <div className="space-y-1">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <div className="rounded-md bg-[var(--muted)] px-3 py-1.5 text-sm">{content}</div>
    </div>
  );
}
