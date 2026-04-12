import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingActivity } from '../types';

// Mock prepare actions
vi.mock('../actions/prepare-activity-email', () => ({
  prepareActivityEmail: vi.fn().mockResolvedValue({
    success: true,
    data: { to: 'test@test.com', subject: 'Subject', body: 'Body', aiPersonalized: false },
  }),
  prepareActivityWhatsApp: vi.fn().mockResolvedValue({
    success: true,
    data: { to: '5511999999999', body: 'WhatsApp body', aiPersonalized: false },
  }),
}));

vi.mock('../actions/fetch-whatsapp-templates', () => ({
  fetchWhatsAppTemplates: vi.fn().mockResolvedValue({
    success: true,
    data: [],
  }),
}));

vi.mock('@/features/cadences/actions/fetch-vendor-variables', () => ({
  fetchVendorVariables: vi.fn().mockResolvedValue({
    success: true,
    data: { nome_vendedor: 'Test User', email_vendedor: 'test@test.com' },
  }),
}));

vi.mock('../actions/fetch-gmail-signature', () => ({
  fetchGmailSignature: vi.fn().mockResolvedValue({
    success: true,
    data: null,
  }),
}));

import { ActivityExecutionSheetContent } from './ActivityExecutionSheetContent';

const baseLead = {
  id: 'lead-1',
  org_id: 'org-1',
  nome_fantasia: 'Acme Corp' as string | null,
  razao_social: null as string | null,
  cnpj: '12345678000100',
  email: 'acme@test.com' as string | null,
  telefone: '11999999999' as string | null,
  municipio: null as string | null,
  uf: null as string | null,
  porte: null as string | null,
  primeiro_nome: null as string | null,
  socios: null,
  endereco: null,
  instagram: null as string | null,
  linkedin: null as string | null,
  website: null as string | null,
  status: null,
  enrichment_status: null,
  notes: null as string | null,
  fit_score: null as number | null,
  engagement_score: null as number | null,
  is_inbound: false,
  created_at: '2026-01-15T10:00:00Z',
};

function makeActivity(channel: string, overrides: Partial<PendingActivity> = {}): PendingActivity {
  return {
    enrollmentId: 'enr-1',
    cadenceId: 'cad-1',
    cadenceName: 'Cadência Padrão',
    cadenceCreatedBy: 'user-1',
    stepId: 'step-1',
    stepOrder: 1,
    totalSteps: 5,
    channel: channel as PendingActivity['channel'],
    templateId: null,
    templateSubject: 'Template Subject',
    templateBody: 'Template Body',
    aiPersonalization: false,
    nextStepDue: new Date().toISOString(),
    isCurrentStep: true,
    lead: baseLead,
    activityName: null,
    callScript: null,
    ...overrides,
  };
}

const noop = () => {};

describe('ActivityExecutionSheetContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render email compose for email channel', async () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('email')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(await screen.findByText('Compor Email')).toBeInTheDocument();
  });

  it('should render whatsapp compose for whatsapp channel', async () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('whatsapp')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(await screen.findByText('Compor WhatsApp')).toBeInTheDocument();
  });

  it('should render social point panel for linkedin channel', () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('linkedin')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(screen.getByText('Social Point')).toBeInTheDocument();
    expect(screen.getByText(/Procurar Acme Corp no LinkedIn/)).toBeInTheDocument();
  });

  it('should render research panel for research channel', () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('research')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(screen.getByText(/Pesquisa — Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText('Checklist de Pesquisa')).toBeInTheDocument();
  });

  it('should render phone panel for phone channel', () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('phone')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('11999999999')).toBeInTheDocument();
  });

  it('should show "Marcar como feita" button for non-email/whatsapp channels', () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('linkedin')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(screen.getByText('Marcar como feita')).toBeInTheDocument();
  });

  it('should show "Enviar Email" button for email channel', async () => {
    render(
      <ActivityExecutionSheetContent
        activity={makeActivity('email')}
        isSending={false}
        onSend={noop}
        onSkip={noop}
        onMarkDone={noop}
      />,
    );

    expect(await screen.findByText('Enviar Email')).toBeInTheDocument();
  });
});
