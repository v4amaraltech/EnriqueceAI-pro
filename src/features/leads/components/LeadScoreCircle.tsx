'use client';

interface LeadScoreCircleProps {
  score: number | null;
  size?: number;
}

function getScoreColor(score: number | null): string {
  if (score === null) return 'text-gray-300 dark:text-gray-400';
  if (score >= 7) return 'text-green-500';
  if (score >= 4) return 'text-yellow-500';
  return 'text-red-500';
}

function getStrokeColor(score: number | null): string {
  if (score === null) return 'stroke-gray-300 dark:stroke-gray-500';
  if (score >= 7) return 'stroke-green-500';
  if (score >= 4) return 'stroke-yellow-500';
  return 'stroke-red-500';
}

export function LeadScoreCircle({ score, size = 36 }: LeadScoreCircleProps) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  // Score range: assume -20 to 20, clamp percentage to 0-100
  const normalizedScore = score !== null ? Math.max(0, Math.min(100, ((score + 20) / 40) * 100)) : 0;
  const dashOffset = circumference - (normalizedScore / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={2.5}
          className="stroke-gray-200 dark:stroke-gray-500"
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
      <span
        className={`absolute text-xs font-bold ${getScoreColor(score)}`}
      >
        {score !== null ? score : '—'}
      </span>
    </div>
  );
}
