'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { formatDuration, getPeriodDates } from '@/features/statistics/types/shared';

import { fetchExtratoData } from '../services/extrato.service';

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportExtratoCsv(
  period: string,
  userIds?: string[],
  dateRange?: { from: string; to: string },
): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: new Date(dateRange.from).toISOString(), end: new Date(dateRange.to + 'T23:59:59').toISOString() }
      : getPeriodDates(period);

    const data = await fetchExtratoData(supabase, orgId, start, end, userIds);

    const lines: string[] = [];

    // KPIs section
    lines.push('RESUMO');
    lines.push(`Total de Ligações,${data.kpis.totalCalls}`);
    lines.push(`Duração Total,${formatDuration(data.kpis.totalDurationSeconds)}`);
    lines.push(`Custo Total,R$ ${data.kpis.totalCost.toFixed(2)}`);
    lines.push(`Média/Dia,${data.kpis.avgCallsPerDay}`);
    lines.push('');

    // Daily breakdown
    lines.push('EXTRATO DIÁRIO');
    lines.push('Data,Ligações,Duração,Significativas,Custo');
    for (const row of data.dailyBreakdown) {
      lines.push(
        [
          row.date,
          String(row.calls),
          formatDuration(row.durationSeconds),
          String(row.significantCalls),
          `R$ ${row.cost.toFixed(2)}`,
        ].join(','),
      );
    }
    lines.push('');

    // SDR breakdown
    lines.push('POR VENDEDOR');
    lines.push('Vendedor,Ligações,Duração Média,Taxa Conexão,Custo');
    for (const row of data.sdrBreakdown) {
      lines.push(
        [
          escapeCsvField(row.userName),
          String(row.calls),
          formatDuration(row.avgDurationSeconds),
          `${row.connectionRate}%`,
          `R$ ${row.cost.toFixed(2)}`,
        ].join(','),
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `extrato-ligacoes-${date}.csv`;

    return { success: true, data: { csv, filename } };
  } catch {
    return { success: false, error: 'Erro ao exportar extrato' };
  }
}
