import { calculateDelta, calculatePreviousPeriod, formatPeriodLabel } from '@/shared/utils/comparison';

import type { CadenceMetrics, ReportData, SdrMetrics } from '../reports.contract';

export interface PdfExportParams {
  orgName: string;
  from: string;
  to: string;
  data: ReportData;
  previousData?: ReportData;
}

function formatDelta(current: number, previous: number): string {
  const delta = calculateDelta(current, previous);
  if (delta.direction === 'neutral') return '→ 0%';
  const sign = delta.direction === 'up' ? '↑ +' : '↓ ';
  if (delta.percentage === null) return `${sign === '↑ +' ? '↑' : '↓'} Novo`;
  return `${sign}${delta.percentage}%`;
}

export async function exportReportPdf(params: PdfExportParams): Promise<void> {
  const { orgName, from, to, data, previousData } = params;
  const hasComparison = !!previousData;

  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const autoTable = autoTableModule.default;
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  const periodLabel = formatPeriodLabel(from, to);

  // --- Helper: add header on current page ---
  function addHeader() {
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Relatório de Performance', margin, 16);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`${orgName}  •  ${periodLabel}`, margin, 23);
    if (hasComparison) {
      const prev = calculatePreviousPeriod(from, to);
      const prevLabel = formatPeriodLabel(prev.from, prev.to);
      doc.text(`Comparando com: ${prevLabel}`, margin, 28);
    }
    doc.setTextColor(0);
  }

  // --- Helper: add footer on all pages ---
  function addFooters() {
    const totalPages = doc.getNumberOfPages();
    const now = new Date();
    const timestamp = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Gerado em ${timestamp} — Flux`,
        margin,
        pageHeight - 8,
      );
      doc.text(
        `Página ${i} de ${totalPages}`,
        pageWidth - margin,
        pageHeight - 8,
        { align: 'right' },
      );
    }
    doc.setTextColor(0);
  }

  // --- Page 1: Header + Overall ---
  addHeader();
  let startY = hasComparison ? 34 : 29;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Visão Geral', margin, startY);
  startY += 4;

  const overallHeaders = ['Etapa', 'Valor', '%'];
  if (hasComparison) overallHeaders.push('Δ Anterior');

  const overallRows = data.overallMetrics.funnelSteps.map((step, i) => {
    const row: (string | number)[] = [step.label, step.count, `${step.percentage}%`];
    if (hasComparison) {
      const prevStep = previousData!.overallMetrics.funnelSteps[i];
      row.push(prevStep ? formatDelta(step.count, prevStep.count) : '—');
    }
    return row;
  });

  autoTable(doc, {
    startY,
    head: [overallHeaders],
    body: overallRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [41, 41, 41], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  });

  // --- Cadence Section ---
  const afterOverall = (doc as any).lastAutoTable?.finalY ?? startY + 30;
  let cadenceY = afterOverall + 10;

  if (cadenceY > pageHeight - 40) {
    doc.addPage();
    addHeader();
    cadenceY = hasComparison ? 34 : 29;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Performance por Cadência', margin, cadenceY);
  cadenceY += 4;

  const cadenceHeaders = [
    'Cadência', 'Inscritos', 'Enviados', 'Abertos', 'Respondidos',
    'Bounce', 'Reuniões', 'Abertura%', 'Resposta%', 'Conversão%',
  ];
  if (hasComparison) cadenceHeaders.push('Δ Conversão');

  const prevCadenceMap = new Map(previousData?.cadenceMetrics.map((m) => [m.cadenceId, m]));

  const cadenceRows = data.cadenceMetrics.map((m: CadenceMetrics) => {
    const row: (string | number)[] = [
      m.cadenceName, m.totalEnrollments, m.sent, m.opened,
      m.replied, m.bounced, m.meetings,
      `${m.openRate}%`, `${m.replyRate}%`, `${m.conversionRate}%`,
    ];
    if (hasComparison) {
      const prev = prevCadenceMap.get(m.cadenceId);
      row.push(prev ? formatDelta(m.conversionRate, prev.conversionRate) : '—');
    }
    return row;
  });

  autoTable(doc, {
    startY: cadenceY,
    head: [cadenceHeaders],
    body: cadenceRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [41, 41, 41], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: { 0: { cellWidth: 40 } },
  });

  // --- SDR Section ---
  const afterCadence = (doc as any).lastAutoTable?.finalY ?? cadenceY + 30;
  let sdrY = afterCadence + 10;

  if (sdrY > pageHeight - 40) {
    doc.addPage();
    addHeader();
    sdrY = hasComparison ? 34 : 29;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Performance por SDR', margin, sdrY);
  sdrY += 4;

  const sdrHeaders = ['SDR', 'Leads', 'Mensagens', 'Respostas', 'Reuniões', 'Conversão%'];
  if (hasComparison) sdrHeaders.push('Δ Conversão');

  const prevSdrMap = new Map(previousData?.sdrMetrics.map((m) => [m.userId, m]));

  const sdrRows = data.sdrMetrics.map((m: SdrMetrics) => {
    const row: (string | number)[] = [
      m.userName, m.leadsWorked, m.messagesSent,
      m.replies, m.meetings, `${m.conversionRate}%`,
    ];
    if (hasComparison) {
      const prev = prevSdrMap.get(m.userId);
      row.push(prev ? formatDelta(m.conversionRate, prev.conversionRate) : '—');
    }
    return row;
  });

  autoTable(doc, {
    startY: sdrY,
    head: [sdrHeaders],
    body: sdrRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [41, 41, 41], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: { 0: { cellWidth: 40 } },
  });

  // --- Footers ---
  addFooters();

  doc.save(`relatorio-${from}-${to}.pdf`);
}
