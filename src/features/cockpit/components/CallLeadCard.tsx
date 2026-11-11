import Image from 'next/image';

import { LEAD_CARD_COLORS as color } from '../utils/lead-card-colors';
import type { LeadCardField, LeadCardModel } from '../utils/lead-card';

function FieldValue({ field }: { field: LeadCardField }) {
  return (
    <p className="mt-0.5 truncate text-[13px] font-semibold leading-snug" title={field.value} style={{ color: color.value }}>
      {field.value}
    </p>
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
          <div data-testid="call-lead-brand" className="flex min-w-0 items-center gap-1.5">
            <Image
              src="/logos/logo-ea-red.png"
              alt=""
              width={18}
              height={18}
              className="h-[18px] w-[18px] shrink-0 rounded-full ring-1 ring-white"
              unoptimized
            />
            <span className="truncate text-sm font-black leading-none tracking-wide" style={{ color: color.headerText }}>
              EnriqueceAI
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
              className={field.fullWidth ? 'col-span-2 min-w-0 px-3 py-2' : 'min-w-0 px-3 py-2'}
              style={{
                borderRight: `1px solid ${color.gridLine}`,
                borderBottom: `1px solid ${color.gridLine}`,
              }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: color.label }}>
                {field.label}
              </p>
              <FieldValue field={field} />
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
