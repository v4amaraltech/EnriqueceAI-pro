interface DialerDaySummaryProps {
  callsToday: number;
  answeredToday: number;
  ratePct: number;
  dailyCap: number;
  /** Quantas ligações ainda cabem no teto do dia. */
  remaining: number;
}

const nf = new Intl.NumberFormat('pt-BR');

function Kpi({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-2xl leading-tight font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Resumo do dia da discagem: só apresentação, os números vêm prontos. */
export function DialerDaySummary({
  callsToday,
  answeredToday,
  ratePct,
  dailyCap,
  remaining,
}: DialerDaySummaryProps) {
  return (
    // `@container`: as colunas seguem a largura DO BLOCO, não da janela (com o painel do lead aberto a coluna fica estreita).
    <section
      className="bg-card @container rounded-lg border p-4"
      aria-labelledby="dialer-day-summary-title"
      data-testid="dialer-day-summary"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="dialer-day-summary-title" className="text-base font-semibold">
          Resumo do dia
        </h3>
        <span className="text-muted-foreground text-xs">
          Teto de {nf.format(dailyCap)} ligações
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 @xl:grid-cols-4">
        <Kpi label="Ligações" value={nf.format(callsToday)} testId="dialer-day-calls" />
        <Kpi label="Conversas" value={nf.format(answeredToday)} testId="dialer-day-answered" />
        <Kpi
          label="Taxa de conversa"
          value={`${nf.format(Math.round(ratePct))}%`}
          testId="dialer-day-rate"
        />
        <Kpi
          label="Faltam para o teto"
          value={nf.format(Math.max(0, remaining))}
          testId="dialer-day-remaining"
        />
      </dl>
    </section>
  );
}
