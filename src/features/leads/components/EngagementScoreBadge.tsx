'use client';

interface EngagementScoreBadgeProps {
  score: number | null;
  size?: number;
}

function getStrokeColor(score: number | null): string {
  if (score === null) return 'stroke-gray-400 dark:stroke-gray-500';
  if (score >= 70) return 'stroke-red-500';
  if (score >= 40) return 'stroke-amber-500';
  if (score >= 15) return 'stroke-blue-500 dark:stroke-blue-400';
  return 'stroke-blue-400 dark:stroke-blue-300';
}

function getTextColor(score: number | null): string {
  if (score === null) return 'text-gray-400 dark:text-gray-400';
  if (score >= 70) return 'text-red-500';
  if (score >= 40) return 'text-amber-500';
  if (score >= 15) return 'text-blue-600 dark:text-blue-400';
  return 'text-blue-500 dark:text-blue-300';
}

export function EngagementScoreBadge({ score, size = 36 }: EngagementScoreBadgeProps) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = score !== null ? Math.max(0, Math.min(100, score)) : 0;
  const dashOffset = circumference - (normalizedScore / 100) * circumference;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      title={score !== null ? `Engajamento: ${score}/100` : 'Sem interações'}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={2.5}
          className="stroke-gray-300 dark:stroke-gray-600"
        />
        {/* Score ring */}
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={2.5}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className={getStrokeColor(score)}
          />
        )}
      </svg>
      <span className={`absolute text-xs font-bold ${getTextColor(score)}`}>
        {score !== null ? score : '—'}
      </span>
    </div>
  );
}
