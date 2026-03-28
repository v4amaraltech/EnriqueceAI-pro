import { escapeCsvField } from '@/lib/utils/csv';

import type { CadenceMetrics, SdrMetrics } from '../reports.contract';

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const headerLine = headers.map(escapeCsvField).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvField).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export function cadenceMetricsToCsv(metrics: CadenceMetrics[]): string {
  const headers = [
    'Cadência',
    'Inscritos',
    'Enviados',
    'Entregues',
    'Abertos',
    'Respondidos',
    'Bounced',
    'Reuniões',
    'Taxa Abertura (%)',
    'Taxa Resposta (%)',
    'Taxa Bounce (%)',
    'Taxa Conversão (%)',
  ];

  const rows = metrics.map((m) => [
    m.cadenceName,
    m.totalEnrollments,
    m.sent,
    m.delivered,
    m.opened,
    m.replied,
    m.bounced,
    m.meetings,
    m.openRate,
    m.replyRate,
    m.bounceRate,
    m.conversionRate,
  ]);

  return toCsv(headers, rows);
}

export function sdrMetricsToCsv(metrics: SdrMetrics[]): string {
  const headers = [
    'SDR',
    'Leads Trabalhados',
    'Mensagens Enviadas',
    'Respostas',
    'Reuniões',
    'Taxa Conversão (%)',
  ];

  const rows = metrics.map((m) => [
    m.userName,
    m.leadsWorked,
    m.messagesSent,
    m.replies,
    m.meetings,
    m.conversionRate,
  ]);

  return toCsv(headers, rows);
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
