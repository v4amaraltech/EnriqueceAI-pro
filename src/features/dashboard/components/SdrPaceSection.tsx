'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

import { getSdrPaceMetrics } from '../actions/get-sdr-pace-data';
import type { SdrOption, SdrPaceData, SdrPaceMetrics } from '../types';
import {
  buildRateKpi,
  buildVolumeKpi,
  formatPerDay,
  monthPaceCalendar,
  type MonthPaceCalendar,
} from '../utils/sdr-pace';
import { PaceKpiCard, type PaceKpiCardProps } from './PaceKpiCard';

const HELP = {
  leadsOpened:
    'Leads que tiveram o 1º contato humano no mês (e-mail, WhatsApp, telefone, LinkedIn ou pesquisa). Conta uma vez por lead, para o SDR dono do lead — mesmo número do ranking "Leads Abertos".',
  meetingsScheduled:
    'Reuniões agendadas no mês (pela data em que foram marcadas) nos leads do SDR. Conta mesmo que a reunião ainda não tenha acontecido.',
  meetingsHeld: 'Reuniões que aconteceram no mês (pela data do evento) nos leads do SDR.',
  calls: 'Todas as ligações feitas pelo SDR no mês (discador e Callface), atendidas ou não.',
  callsConnected:
    'Ligações atendidas por uma pessoa com conversa de pelo menos 50 segundos. Caixa postal não conta.',
  connectedToScheduled:
    'Reuniões marcadas ÷ ligações conectadas: quanto o SDR aproveita cada conversa. Meta = meta de marcadas ÷ meta de conectadas.',
  connectedRate:
    'Ligações conectadas ÷ total de ligações. Meta = meta de conectadas ÷ meta de ligações.',
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function volumeCard(label: string, help: string, actual: number, target: number, cal: MonthPaceCalendar): PaceKpiCardProps {
  const kpi = buildVolumeKpi(actual, target, cal);
  const delta = kpi.deltaVsPace;
  return {
    label,
    help,
    value: fmtInt(kpi.actual),
    target: kpi.target > 0 ? fmtInt(kpi.target) : undefined,
    pct: kpi.pct,
    status: kpi.status,
    markerFraction: kpi.markerFraction,
    today: kpi.today ? { text: fmtInt(kpi.today.value), onTrack: kpi.today.onTrack } : null,
    remainingText: kpi.remaining !== null ? fmtInt(kpi.remaining) : null,
    perDayText: kpi.perDay !== null ? formatPerDay(kpi.perDay) : null,
    paceDelta:
      delta !== null && Math.abs(delta) >= 0.5
        ? { text: `${delta >= 0 ? '+' : ''}${fmtInt(delta)}`, positive: delta >= 0 }
        : null,
  };
}

function rateCard(
  label: string,
  help: string,
  num: number,
  den: number,
  numTarget: number,
  denTarget: number,
): PaceKpiCardProps {
  const kpi = buildRateKpi(num, den, numTarget, denTarget);
  return {
    label,
    help,
    isRate: true,
    value: fmtPct(kpi.actual),
    target: kpi.target !== null ? fmtPct(kpi.target) : undefined,
    pct: kpi.pct,
    status: kpi.status,
  };
}

function buildCards(m: SdrPaceMetrics, cal: MonthPaceCalendar): PaceKpiCardProps[] {
  const { actual: a, target: t } = m;
  return [
    volumeCard('Leads Abertos', HELP.leadsOpened, a.leadsOpened, t.leadsOpened, cal),
    volumeCard('Reuniões Marcadas', HELP.meetingsScheduled, a.meetingsScheduled, t.meetingsScheduled, cal),
    volumeCard('Reuniões Realizadas', HELP.meetingsHeld, a.meetingsHeld, t.meetingsHeld, cal),
    volumeCard('Total de Ligações', HELP.calls, a.calls, t.calls, cal),
    volumeCard('Ligações Conectadas', HELP.callsConnected, a.callsConnected, t.callsConnected, cal),
    rateCard(
      'Conectada p/ Marcada',
      HELP.connectedToScheduled,
      a.meetingsScheduled,
      a.callsConnected,
      t.meetingsScheduled,
      t.callsConnected,
    ),
    rateCard('% de Conectadas', HELP.connectedRate, a.callsConnected, a.calls, t.callsConnected, t.calls),
  ];
}

function SdrAvatar({ sdr, className }: { sdr: SdrOption; className?: string }) {
  return (
    <Avatar className={cn('h-7 w-7', className)}>
      {sdr.avatarUrl && <AvatarImage src={sdr.avatarUrl} alt={sdr.userName} />}
      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials(sdr.userName)}</AvatarFallback>
    </Avatar>
  );
}

interface SdrPaceSectionProps {
  data: SdrPaceData;
}

/**
 * Seção "SDR selecionado": realizado × meta individual do mês em 7 cards, com o
 * ritmo do dia (porte do /sdrs do Sales Hub). Segue o filtro de mês do
 * dashboard; ignora cadência/vendedores (as metas valem para o mês inteiro).
 * Trocar o SDR busca só os números dele e atualiza `?sdr=` sem recarregar a página.
 */
export function SdrPaceSection({ data }: SdrPaceSectionProps) {
  const [selectedUserId, setSelectedUserId] = useState(data.selectedUserId);
  const [metrics, setMetrics] = useState(data.metrics);
  const [isPending, startTransition] = useTransition();
  const requestSeq = useRef(0);

  // Nova carga do servidor (troca de mês, metas salvas → revalidatePath): a
  // prop manda. Sem isto o useState congelaria os números da 1ª renderização.
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setSelectedUserId(data.selectedUserId);
    setMetrics(data.metrics);
  }

  const cards = useMemo(
    () => (metrics ? buildCards(metrics, monthPaceCalendar(data.month)) : []),
    [metrics, data.month],
  );

  if (data.sdrs.length === 0 || !selectedUserId) return null;
  const selectedSdr = data.sdrs.find((s) => s.userId === selectedUserId);

  function handleChange(userId: string) {
    if (userId === selectedUserId) return;
    setSelectedUserId(userId);

    const params = new URLSearchParams(window.location.search);
    params.set('sdr', userId);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);

    const seq = ++requestSeq.current;
    startTransition(async () => {
      const result = await getSdrPaceMetrics({ month: data.month, userId });
      if (seq !== requestSeq.current) return; // troca mais nova já em andamento
      if (result.success) setMetrics(result.data);
      else toast.error(result.error);
    });
  }

  return (
    <section className="space-y-4" data-slot="sdr-pace-section">
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          SDR selecionado
        </p>
        <Select value={selectedUserId} onValueChange={handleChange}>
          <SelectTrigger className="h-12 w-full text-base font-medium" aria-label="SDR selecionado">
            {/* Conteúdo explícito: avatar + nome já no HTML do servidor (o Radix só
                preencheria o valor depois de hidratar). */}
            <SelectValue>
              {selectedSdr && (
                <>
                  <SdrAvatar sdr={selectedSdr} />
                  {selectedSdr.userName}
                </>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {data.sdrs.map((sdr) => (
              <SelectItem key={sdr.userId} value={sdr.userId}>
                <SdrAvatar sdr={sdr} className="h-6 w-6" />
                {sdr.userName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className={cn(
          'grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7 transition-opacity',
          isPending && 'pointer-events-none opacity-60',
        )}
        aria-busy={isPending}
      >
        {cards.map((card) => (
          <PaceKpiCard key={card.label} {...card} />
        ))}
      </div>
    </section>
  );
}
