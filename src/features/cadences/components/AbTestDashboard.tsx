'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { AlertCircle, Award, Loader2, Trophy } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import type { StepAbMetrics } from '../cadences.contract';
import { declareAbWinner } from '../actions/declare-ab-winner';
import { fetchStepAbMetrics } from '../actions/fetch-step-ab-metrics';

interface AbTestDashboardProps {
  stepIds: string[];
}

const CONFIDENCE_CONFIG = {
  low: { label: 'Baixa', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  medium: { label: 'Média', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  high: { label: 'Alta', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
} as const;

export function AbTestDashboard({ stepIds }: AbTestDashboardProps) {
  const [metricsMap, setMetricsMap] = useState<Map<string, StepAbMetrics>>(new Map());
  const [loading, setLoading] = useState(true);
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;

    async function load() {
      const results = await Promise.all(stepIds.map((id) => fetchStepAbMetrics(id)));
      const map = new Map<string, StepAbMetrics>();
      for (const result of results) {
        if (result.success) {
          map.set(result.data.stepId, result.data);
        }
      }

      // Auto-declare winner if conditions are met
      for (const [, metrics] of map) {
        if (metrics.canDeclareWinner && metrics.pValue !== null && metrics.pValue < 0.05 && !metrics.winnerVariant) {
          const winner = metrics.variant_a.replyRate >= metrics.variant_b.replyRate ? 'A' : 'B';
          const res = await declareAbWinner({ stepId: metrics.stepId, variant: winner });
          if (res.success) {
            map.set(metrics.stepId, { ...metrics, winnerVariant: winner, winnerAt: new Date().toISOString(), canDeclareWinner: false });
          }
        }
      }

      startTransition(() => {
        setMetricsMap(map);
        setLoading(false);
      });
    }

    load();
  }, [stepIds, startTransition]);

  const handleDeclareWinner = async (stepId: string, variant: 'A' | 'B') => {
    setDeclaring(stepId);
    const result = await declareAbWinner({ stepId, variant });
    if (result.success) {
      const current = metricsMap.get(stepId);
      if (current) {
        const updated = new Map(metricsMap);
        updated.set(stepId, { ...current, winnerVariant: variant, winnerAt: new Date().toISOString(), canDeclareWinner: false });
        setMetricsMap(updated);
      }
    }
    setDeclaring(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        <span className="ml-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Carregando métricas A/B...</span>
      </div>
    );
  }

  if (metricsMap.size === 0) return null;

  return (
    <div className="space-y-4">
      {[...metricsMap.values()].map((metrics) => (
        <StepAbCard
          key={metrics.stepId}
          metrics={metrics}
          declaring={declaring === metrics.stepId}
          onDeclareWinner={(variant) => handleDeclareWinner(metrics.stepId, variant)}
        />
      ))}
    </div>
  );
}

function StepAbCard({
  metrics,
  declaring,
  onDeclareWinner,
}: {
  metrics: StepAbMetrics;
  declaring: boolean;
  onDeclareWinner: (variant: 'A' | 'B') => void;
}) {
  const { variant_a, variant_b, confidence, pValue, canDeclareWinner, winnerVariant, winnerAt } = metrics;
  const confConfig = CONFIDENCE_CONFIG[confidence];

  // Determine which variant leads in reply rate
  const aLeads = variant_a.replyRate > variant_b.replyRate;
  const bLeads = variant_b.replyRate > variant_a.replyRate;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-4 w-4" />
            Teste A/B — Etapa {metrics.stepOrder}
          </CardTitle>
          <Badge className={confConfig.className}>
            Confiança: {confConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {winnerVariant && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
            <Trophy className="h-4 w-4" />
            Variante {winnerVariant} declarada vencedora
            {winnerAt && ` em ${new Date(winnerAt).toLocaleDateString('pt-BR')}`}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                <th className="pb-2 pr-4 font-medium">Métrica</th>
                <th className="pb-2 pr-4 text-right font-medium">Variante A</th>
                <th className="pb-2 text-right font-medium">Variante B</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow label="Enviados" a={variant_a.sent} b={variant_b.sent} />
              <MetricRow label="Taxa Abertura" a={variant_a.openRate} b={variant_b.openRate} suffix="%" highlightHigher />
              <MetricRow label="Taxa Resposta" a={variant_a.replyRate} b={variant_b.replyRate} suffix="%" highlightHigher primary />
              <MetricRow label="Taxa Bounce" a={variant_a.bounceRate} b={variant_b.bounceRate} suffix="%" highlightLower />
            </tbody>
          </table>
        </div>

        {pValue !== null && (
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            p-value: {pValue} {pValue < 0.05 ? '(significativo)' : '(não significativo)'}
          </p>
        )}

        {!winnerVariant && !canDeclareWinner && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>
              Necessário mínimo de 50 envios por variante e 7 dias de teste para declarar vencedor.
              {variant_a.sent < 50 && ` Variante A: ${variant_a.sent}/50 envios.`}
              {variant_b.sent < 50 && ` Variante B: ${variant_b.sent}/50 envios.`}
            </span>
          </div>
        )}

        {!winnerVariant && canDeclareWinner && pValue !== null && pValue >= 0.05 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Sem diferença significativa. Declarar manualmente:</span>
            <Button
              size="sm"
              variant={aLeads ? 'default' : 'outline'}
              disabled={declaring}
              onClick={() => onDeclareWinner('A')}
            >
              {declaring ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Variante A
            </Button>
            <Button
              size="sm"
              variant={bLeads ? 'default' : 'outline'}
              disabled={declaring}
              onClick={() => onDeclareWinner('B')}
            >
              {declaring ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Variante B
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricRow({
  label,
  a,
  b,
  suffix = '',
  highlightHigher = false,
  highlightLower = false,
  primary = false,
}: {
  label: string;
  a: number;
  b: number;
  suffix?: string;
  highlightHigher?: boolean;
  highlightLower?: boolean;
  primary?: boolean;
}) {
  const aWins = highlightHigher ? a > b : highlightLower ? a < b : false;
  const bWins = highlightHigher ? b > a : highlightLower ? b < a : false;

  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className={`py-2 pr-4 ${primary ? 'font-medium' : ''}`}>{label}</td>
      <td className={`py-2 pr-4 text-right ${aWins ? 'font-semibold text-green-600 dark:text-green-400' : ''}`}>
        {a}{suffix}
      </td>
      <td className={`py-2 text-right ${bWins ? 'font-semibold text-green-600 dark:text-green-400' : ''}`}>
        {b}{suffix}
      </td>
    </tr>
  );
}
