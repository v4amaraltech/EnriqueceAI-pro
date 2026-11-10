import type { ReactNode } from 'react';

interface MeetimeFieldRowProps {
  label: string;
  value: string | ReactNode;
  href?: string;
  mono?: boolean;
  /** When true, the value wraps and the box grows to fit the full text
   *  (preserving line breaks) instead of truncating to a single line. */
  multiline?: boolean;
}

export function MeetimeFieldRow({ label, value, href, mono, multiline }: MeetimeFieldRowProps) {
  const valueClass = multiline ? 'whitespace-pre-wrap break-words' : 'truncate';
  const content = href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`text-[var(--primary)] hover:underline ${valueClass}`}>
      {value}
    </a>
  ) : (
    <span className={`${valueClass} ${mono ? 'font-mono text-sm' : ''}`}>{value}</span>
  );

  return (
    <div className="space-y-1">
      <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{label}</p>
      <div className={`min-w-0 rounded-md border border-border bg-[var(--muted)] px-3 py-2 text-base ${multiline ? '' : 'overflow-hidden'}`}>{content}</div>
    </div>
  );
}
