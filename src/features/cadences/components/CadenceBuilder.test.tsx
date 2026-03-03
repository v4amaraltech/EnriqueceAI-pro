import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CadenceDetail } from '../cadences.contract';
import type { MessageTemplateRow } from '../types';
import { CadenceBuilder } from './CadenceBuilder';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('../actions/manage-cadences', () => ({
  createCadence: vi.fn(),
  updateCadence: vi.fn(),
  activateCadence: vi.fn(),
}));

vi.mock('../actions/save-timeline-steps', () => ({
  saveTimelineSteps: vi.fn(),
}));

vi.mock('./CadenceTimeline', () => ({
  CadenceTimeline: ({ days, sidebarSlot, onStepClick: _onStepClick }: { days: { day: number; steps: unknown[] }[]; sidebarSlot?: React.ReactNode; onStepClick?: (step: unknown) => void }) => (
    <div data-testid="cadence-timeline">
      Timeline ({days.reduce((sum, d) => sum + d.steps.length, 0)} steps)
      {sidebarSlot}
    </div>
  ),
}));

vi.mock('./ActivityTypeSidebar', () => ({
  ActivityTypeSidebar: () => <div data-testid="activity-sidebar">Sidebar</div>,
  channelConfig: {
    email: { icon: () => null, color: 'text-blue-500', bgColor: 'bg-blue-50', label: 'E-mail' },
    whatsapp: { icon: () => null, color: 'text-green-600', bgColor: 'bg-green-50', label: 'WhatsApp' },
    phone: { icon: () => null, color: 'text-green-500', bgColor: 'bg-green-50', label: 'Ligação' },
    linkedin: { icon: () => null, color: 'text-purple-500', bgColor: 'bg-purple-50', label: 'LinkedIn' },
    research: { icon: () => null, color: 'text-orange-500', bgColor: 'bg-orange-50', label: 'Pesquisa' },
  },
}));

vi.mock('./EnrollmentsList', () => ({
  EnrollmentsList: () => <div data-testid="enrollments-list">Enrollments</div>,
}));

vi.mock('./StepEditorDialog', () => ({
  StepEditorDialog: () => null,
}));

function createTemplate(overrides: Partial<MessageTemplateRow> = {}): MessageTemplateRow {
  return {
    id: 'tmpl-1',
    org_id: 'org-1',
    name: 'Primeiro Contato',
    channel: 'email',
    subject: 'Olá {{nome_fantasia}}',
    body: 'Corpo do email',
    variables_used: ['nome_fantasia'],
    is_system: false,
    created_by: 'user-1',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    ...overrides,
  };
}

function createCadence(overrides: Partial<CadenceDetail> = {}): CadenceDetail {
  return {
    id: 'cad-1',
    org_id: 'org-1',
    name: 'Follow Up Inicial',
    description: 'Cadência de primeiro contato',
    status: 'draft',
    priority: 'medium',
    origin: 'outbound',
    type: 'standard',
    total_steps: 0,
    auto_loss_after_days: null,
    auto_loss_reason_id: null,
    created_by: 'user-1',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    deleted_at: null,
    steps: [],
    enrollment_count: 0,
    ...overrides,
  };
}

describe('CadenceBuilder', () => {
  it('should render "Nova Cadência" for new cadence', () => {
    render(<CadenceBuilder templates={[createTemplate()]} />);
    expect(screen.getByText('Nova Cadência')).toBeInTheDocument();
  });

  it('should render cadence name for existing cadence', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    expect(screen.getByText('Follow Up Inicial')).toBeInTheDocument();
  });

  it('should show status badge for existing cadence', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
  });

  it('should show name input with cadence name', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    const input = screen.getByDisplayValue('Follow Up Inicial');
    expect(input).toBeInTheDocument();
  });

  it('should show description textarea', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    const textarea = screen.getByDisplayValue('Cadência de primeiro contato');
    expect(textarea).toBeInTheDocument();
  });

  it('should render timeline for existing draft cadence', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    expect(screen.getByTestId('cadence-timeline')).toBeInTheDocument();
  });

  it('should render activity sidebar for editable cadence', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    expect(screen.getByTestId('activity-sidebar')).toBeInTheDocument();
  });

  it('should show "Criar Cadência" button for new cadence', () => {
    render(<CadenceBuilder templates={[createTemplate()]} />);
    expect(screen.getByText('Criar Cadência')).toBeInTheDocument();
  });

  it('should show "Salvar" button for existing cadence', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    expect(screen.getByText('Salvar')).toBeInTheDocument();
  });

  it('should render timeline with steps when cadence has steps', () => {
    const cadence = createCadence({
      total_steps: 2,
      steps: [
        {
          id: 'step-1',
          cadence_id: 'cad-1',
          step_order: 1,
          channel: 'email',
          template_id: 'tmpl-1',
          delay_days: 0,
          delay_hours: 0,
          ai_personalization: false,
          activity_name: null,
          instructions: null,
          reply_type: 'new_conversation' as const,
          created_at: '2026-02-15T10:00:00Z',
          template: { id: 'tmpl-1', name: 'Primeiro Contato', org_id: 'org-1', channel: 'email', subject: 'Olá', body: 'Corpo', variables_used: [], is_system: false, created_by: 'user-1', created_at: '2026-02-15T10:00:00Z', updated_at: '2026-02-15T10:00:00Z' },
        },
        {
          id: 'step-2',
          cadence_id: 'cad-1',
          step_order: 2,
          channel: 'whatsapp',
          template_id: null,
          delay_days: 2,
          delay_hours: 0,
          ai_personalization: false,
          activity_name: null,
          instructions: null,
          reply_type: 'new_conversation' as const,
          created_at: '2026-02-15T10:00:00Z',
          template: null,
        },
      ],
    });
    render(<CadenceBuilder cadence={cadence} templates={[createTemplate()]} />);
    expect(screen.getByTestId('cadence-timeline')).toBeInTheDocument();
    expect(screen.getByText('Timeline (2 steps)')).toBeInTheDocument();
  });

  it('should show activate button for draft with >= 2 steps', () => {
    const cadence = createCadence({
      total_steps: 2,
      steps: [
        {
          id: 'step-1',
          cadence_id: 'cad-1',
          step_order: 1,
          channel: 'email',
          template_id: null,
          delay_days: 0,
          delay_hours: 0,
          ai_personalization: false,
          activity_name: null,
          instructions: null,
          reply_type: 'new_conversation' as const,
          created_at: '2026-02-15T10:00:00Z',
          template: null,
        },
        {
          id: 'step-2',
          cadence_id: 'cad-1',
          step_order: 2,
          channel: 'email',
          template_id: null,
          delay_days: 1,
          delay_hours: 0,
          ai_personalization: false,
          activity_name: null,
          instructions: null,
          reply_type: 'new_conversation' as const,
          created_at: '2026-02-15T10:00:00Z',
          template: null,
        },
      ],
    });
    render(<CadenceBuilder cadence={cadence} templates={[createTemplate()]} />);
    expect(screen.getByText('Ativar')).toBeInTheDocument();
  });

  it('should show priority select with default value', () => {
    render(<CadenceBuilder cadence={createCadence({ priority: 'high' })} templates={[createTemplate()]} />);
    expect(screen.getByText('Alta')).toBeInTheDocument();
  });

  it('should show origin toggle buttons', () => {
    render(<CadenceBuilder cadence={createCadence()} templates={[createTemplate()]} />);
    expect(screen.getByText('Outbound')).toBeInTheDocument();
    expect(screen.getByText('Inbound ativo')).toBeInTheDocument();
    expect(screen.getByText('Inbound passivo')).toBeInTheDocument();
  });

  it('should show tabs for active cadence', () => {
    const cadence = createCadence({
      status: 'active',
      total_steps: 2,
      steps: [
        {
          id: 'step-1',
          cadence_id: 'cad-1',
          step_order: 1,
          channel: 'email',
          template_id: null,
          delay_days: 0,
          delay_hours: 0,
          ai_personalization: false,
          activity_name: null,
          instructions: null,
          reply_type: 'new_conversation' as const,
          created_at: '2026-02-15T10:00:00Z',
          template: null,
        },
        {
          id: 'step-2',
          cadence_id: 'cad-1',
          step_order: 2,
          channel: 'email',
          template_id: null,
          delay_days: 1,
          delay_hours: 0,
          ai_personalization: false,
          activity_name: null,
          instructions: null,
          reply_type: 'new_conversation' as const,
          created_at: '2026-02-15T10:00:00Z',
          template: null,
        },
      ],
    });
    render(<CadenceBuilder cadence={cadence} templates={[createTemplate()]} />);
    expect(screen.getByText('Passos (2)')).toBeInTheDocument();
    expect(screen.getByText('Inscritos (0)')).toBeInTheDocument();
  });
});
