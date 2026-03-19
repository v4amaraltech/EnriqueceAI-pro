import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportData } from '../reports.contract';

// These are populated by the mock factory via globalThis
const mocks = {
  save: vi.fn(),
  text: vi.fn(),
  autoTable: vi.fn(),
  constructor: vi.fn(),
};

vi.mock('jspdf', () => {
  class MockJsPDF {
    text = mocks.text;
    setFontSize = vi.fn();
    setFont = vi.fn();
    setTextColor = vi.fn();
    setPage = vi.fn();
    addPage = vi.fn();
    getNumberOfPages = vi.fn(() => 1);
    save = mocks.save;
    internal = {
      pageSize: {
        getWidth: () => 297,
        getHeight: () => 210,
      },
    };
    lastAutoTable = { finalY: 60 };

    constructor(...args: unknown[]) {
      mocks.constructor(...args);
    }
  }
  return { default: MockJsPDF };
});

vi.mock('jspdf-autotable', () => ({
  default: (...args: unknown[]) => mocks.autoTable(...args),
}));

function makeReportData(): ReportData {
  return {
    overallMetrics: {
      totalLeads: 200,
      contacted: 120,
      replied: 40,
      meetings: 15,
      qualified: 10,
      funnelSteps: [
        { label: 'Total de Leads', count: 200, percentage: 100, color: '#6366f1' },
        { label: 'Contactados', count: 120, percentage: 60, color: '#8b5cf6' },
        { label: 'Responderam', count: 40, percentage: 20, color: '#a78bfa' },
      ],
    },
    cadenceMetrics: [
      {
        cadenceId: 'c1',
        cadenceName: 'Outbound Q1',
        totalEnrollments: 100,
        sent: 90,
        delivered: 85,
        opened: 45,
        replied: 10,
        bounced: 5,
        meetings: 3,
        openRate: 50,
        replyRate: 11.1,
        bounceRate: 5.6,
        conversionRate: 10,
      },
    ],
    sdrMetrics: [
      {
        userId: 'u1',
        userName: 'Maria Silva',
        leadsWorked: 50,
        messagesSent: 120,
        replies: 15,
        meetings: 5,
        conversionRate: 30,
      },
    ],
  };
}

describe('exportReportPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a landscape A4 PDF', async () => {
    const { exportReportPdf } = await import('./pdf-export');

    await exportReportPdf({
      orgName: 'Acme Corp',
      from: '2026-03-01',
      to: '2026-03-15',
      data: makeReportData(),
    });

    expect(mocks.constructor).toHaveBeenCalledWith('l', 'mm', 'a4');
  });

  it('should call autoTable 3 times (overall, cadence, sdr)', async () => {
    const { exportReportPdf } = await import('./pdf-export');

    await exportReportPdf({
      orgName: 'Acme Corp',
      from: '2026-03-01',
      to: '2026-03-15',
      data: makeReportData(),
    });

    expect(mocks.autoTable).toHaveBeenCalledTimes(3);
  });

  it('should save with correct filename', async () => {
    const { exportReportPdf } = await import('./pdf-export');

    await exportReportPdf({
      orgName: 'Acme Corp',
      from: '2026-03-01',
      to: '2026-03-15',
      data: makeReportData(),
    });

    expect(mocks.save).toHaveBeenCalledWith('relatorio-2026-03-01-2026-03-15.pdf');
  });

  it('should include delta column when previousData is provided', async () => {
    const { exportReportPdf } = await import('./pdf-export');
    const data = makeReportData();
    const previousData = makeReportData();

    await exportReportPdf({
      orgName: 'Acme Corp',
      from: '2026-03-01',
      to: '2026-03-15',
      data,
      previousData,
    });

    const overallHeaders = mocks.autoTable.mock.calls[0]![1].head[0];
    expect(overallHeaders).toContain('Δ Anterior');

    const cadenceHeaders = mocks.autoTable.mock.calls[1]![1].head[0];
    expect(cadenceHeaders).toContain('Δ Conversão');

    const sdrHeaders = mocks.autoTable.mock.calls[2]![1].head[0];
    expect(sdrHeaders).toContain('Δ Conversão');
  });

  it('should NOT include delta columns without previousData', async () => {
    const { exportReportPdf } = await import('./pdf-export');

    await exportReportPdf({
      orgName: 'Acme Corp',
      from: '2026-03-01',
      to: '2026-03-15',
      data: makeReportData(),
    });

    const overallHeaders = mocks.autoTable.mock.calls[0]![1].head[0];
    expect(overallHeaders).not.toContain('Δ Anterior');

    const cadenceHeaders = mocks.autoTable.mock.calls[1]![1].head[0];
    expect(cadenceHeaders).not.toContain('Δ Conversão');
  });

  it('should render header with org name and period', async () => {
    const { exportReportPdf } = await import('./pdf-export');

    await exportReportPdf({
      orgName: 'Acme Corp',
      from: '2026-03-01',
      to: '2026-03-15',
      data: makeReportData(),
    });

    expect(mocks.text).toHaveBeenCalledWith('Relatório de Performance', expect.any(Number), expect.any(Number));
    expect(mocks.text).toHaveBeenCalledWith(
      expect.stringContaining('Acme Corp'),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
