import { LEAD_CARD_COLORS as color } from '../utils/lead-card-colors';
import type { LeadCardModel } from '../utils/lead-card';

function V4Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="6" fill="#ffffff" />
      <text
        x="16"
        y="24"
        textAnchor="middle"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="22"
        fontWeight="800"
        fill={color.headerBackground}
      >
        4
      </text>
    </svg>
  );
}

export function CallLeadCard({ model }: { model: LeadCardModel }) {
  return (
    <div data-testid="call-lead-card">
      <article
        className="overflow-hidden rounded-lg border-2"
        style={{ backgroundColor: color.cardBackground, borderColor: color.headerBackground }}
      >
        <header className="flex items-center justify-between gap-2 px-3 py-2.5" style={{ backgroundColor: color.headerBackground }}>
          <div className="flex min-w-0 items-center gap-2">
            <V4Mark />
            <span className="truncate text-sm font-black tracking-[0.14em]" style={{ color: color.headerText }}>
              COMPANY
            </span>
          </div>
          <span
            data-testid="call-lead-attempt"
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide"
            style={{ backgroundColor: color.badgeBackground, color: color.badgeText }}
          >
            {model.attemptLabel}
          </span>
        </header>

        <div className="px-3 pt-3 pb-3">
          {model.name && (
            <h2 className="text-[1.7rem] font-black uppercase leading-[0.95] tracking-tight break-words" style={{ color: color.value }}>
              {model.name}
            </h2>
          )}
          {model.company && (
            <p className="mt-1 text-sm font-bold uppercase tracking-wide" style={{ color: color.label }}>
              {model.company}
            </p>
          )}
        </div>

        <div
          className="grid grid-cols-2"
          style={{ borderTop: `1px solid ${color.gridLine}`, borderLeft: `1px solid ${color.gridLine}` }}
        >
          {model.fields.map((field) => (
            <div
              key={field.id}
              data-testid={`lead-card-${field.id}`}
              className={field.fullWidth ? 'col-span-2 px-3 py-2' : 'px-3 py-2'}
              style={{
                borderRight: `1px solid ${color.gridLine}`,
                borderBottom: `1px solid ${color.gridLine}`,
              }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: color.label }}>
                {field.label}
              </p>
              <p className="mt-0.5 text-[13px] font-semibold leading-snug break-words" style={{ color: color.value }}>
                {field.value}
              </p>
            </div>
          ))}
        </div>
      </article>

      {model.opening && (
        <section
          data-testid="call-lead-opening"
          className="mt-3 rounded-md border border-l-[6px] px-3 py-3"
          style={{
            backgroundColor: color.openingBackground,
            borderColor: '#d4d4d4',
            borderLeftColor: color.openingBorder,
            color: color.openingText,
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: color.openingLabel }}>
            Abertura sugerida
          </p>
          <p className="mt-1 text-sm font-medium leading-snug">{model.opening}</p>
        </section>
      )}
    </div>
  );
}
