import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingActivity } from '@/features/activities/types';

import { FIXTURE_ACTIVITY, FIXTURE_HISTORY, FIXTURE_PREVIEW } from '@/app/demo/call-workspace/fixture';
import { DEFAULT_MEETING_INVITE_DESCRIPTION } from '@/features/integrations/meeting-invite-description';

import { callNoteKey, readCallNote } from '../utils/call-note-draft';

import { CallSidePanel } from './CallSidePanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string; height?: number }) => (
    <span role="presentation" data-src={props.src} data-height={props.height} />
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/features/activities/components/ActivityPhonePanel', () => ({
  ActivityPhonePanel: ({ layout, companionNotes }: { layout?: string; companionNotes?: string }) => (
    <div data-testid="phone-dock" data-layout={layout}>{companionNotes}</div>
  ),
}));
vi.mock('@/features/settings-prospecting/actions/closers-crud', () => ({ listClosers: vi.fn() }));
vi.mock('@/features/integrations/actions/schedule-meeting', () => ({
  scheduleMeeting: vi.fn(),
  getAvailability: vi.fn(),
  getLoggedUserEmail: vi.fn(),
  getLeadFaturamento: vi.fn(),
}));
vi.mock('@/features/meetings/closer-availability.action', () => ({ getCloserAvailability: vi.fn() }));
vi.mock('@/features/leads/actions/get-missing-meeting-fields', () => ({ getMissingMeetingFields: vi.fn() }));
vi.mock('@/features/activities/actions/check-whatsapp-status', () => ({ checkWhatsAppConnected: vi.fn() }));
vi.mock('@/features/integrations/actions/manage-calendar', () => ({ getCalendarAuthUrl: vi.fn() }));

import { getAvailability, scheduleMeeting } from '@/features/integrations/actions/schedule-meeting';
import { getCloserAvailability } from '@/features/meetings/closer-availability.action';
import { listClosers } from '@/features/settings-prospecting/actions/closers-crud';

const activity: PendingActivity = FIXTURE_ACTIVITY;

function renderPanel(onScheduled = vi.fn()) {
  return render(
    <CallSidePanel
      activity={activity}
      dialerProvider="api4com"
      minimized={false}
      onMinimize={vi.fn()}
      onRestore={vi.fn()}
      onClose={vi.fn()}
      onMarkDone={vi.fn()}
      onSkip={vi.fn()}
      onLeadLost={vi.fn()}
      onScheduled={onScheduled}
      history={FIXTURE_HISTORY}
      schedulingPreview={FIXTURE_PREVIEW}
    />,
  );
}

describe('CallSidePanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('mantém a lista de contexto e o histórico sem esconder atrás do discador', () => {
    renderPanel();
    expect(screen.getByTestId('phone-dock').getAttribute('data-layout')).toBe('dock');
    expect(screen.getByTestId('call-side-panel').className).toContain('sm:max-w-[380px]');
    expect(screen.getByText('Empresa Fixture Ltda')).toBeTruthy();
    expect(screen.getByText('Fixture · Outbound')).toBeTruthy();
    expect(screen.getByText('Contatado')).toBeTruthy();
    expect(screen.getByText(/Prospecção fixture/)).toBeTruthy();
    expect(screen.getByText('Enriquecido')).toBeTruthy();
    expect(screen.getByText('Perguntar quem decide e se já houve contato anterior. Fixture.')).toBeTruthy();
    expect(screen.getByText('Respondeu · e-mail')).toBeTruthy();
    expect(screen.getByText('Envio · e-mail')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agendar reunião' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desqualificar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adiar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull();
  });

  it('guarda a anotação ao fechar o campo', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Anotações'), { target: { value: 'ligar de novo na quinta' } });
    expect(readCallNote(callNoteKey(activity.enrollmentId, activity.stepId))).toBe('ligar de novo na quinta');
  });

  it('agenda pela grade e confirma uma vez, sem chamar o servidor na fixture', () => {
    const onScheduled = vi.fn();
    renderPanel(onScheduled);
    fireEvent.click(screen.getByRole('button', { name: 'Agendar reunião' }));
    expect(listClosers).not.toHaveBeenCalled();
    expect(getAvailability).not.toHaveBeenCalled();
    expect(getCloserAvailability).not.toHaveBeenCalled();
    expect(screen.getByTestId('slot-0-11').textContent).toContain('Ocupado');
    expect(screen.getByTestId('slot-0-11').textContent).not.toContain('Livre');
    fireEvent.click(screen.getByTestId('slot-0-14'));
    fireEvent.click(screen.getByRole('button', { name: /^Closers/ }));
    fireEvent.click(screen.getByTestId('closer-closer-1'));
    const schedule = screen.getByRole('button', { name: (name) => name === 'Agendar' });
    expect(schedule).toBeEnabled();
    fireEvent.click(schedule);
    expect(screen.getByTestId('participant-Closer').textContent).toContain('Closer Fixture');
    expect(screen.getByTestId('participant-Organizador').textContent).toContain('sdr.fixture@example.com');
    expect(screen.getByTestId('participant-Lead').textContent).toContain('contato.fixture@example.com');
    expect(screen.getByLabelText('Descrição do convite')).toHaveValue(DEFAULT_MEETING_INVITE_DESCRIPTION);
    expect(screen.getByLabelText('Título do convite da reunião')).toHaveValue('V4 Company + Empresa Fixture Ltda');
    const confirm = screen.getByTestId('confirm-meeting');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onScheduled).toHaveBeenCalledTimes(1);
    expect(scheduleMeeting).not.toHaveBeenCalled();
  });

  it('com a flag desligada o meio do painel continua a lista de hoje', () => {
    renderPanel();
    expect(screen.queryByTestId('call-lead-card')).toBeNull();
    expect(screen.queryByTestId('call-history-collapse')).toBeNull();
    expect(screen.getByText('Enriquecido')).toBeTruthy();
    expect(screen.getByTestId('phone-dock').getAttribute('data-layout')).toBe('dock');
    expect(screen.getByRole('button', { name: 'Minimizar painel' })).toBeTruthy();
    expect(screen.getByLabelText('Anotações')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agendar reunião' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desqualificar' })).toBeTruthy();
  });

  it('com a flag ligada troca só o meio e mantém topo, rodapé e agendamento', () => {
    const lostActivity: PendingActivity = {
      ...activity,
      stepOrder: 3,
      totalSteps: 3,
      lead: {
        ...activity.lead,
        lost_at: '2026-04-17T10:22:48.000Z',
        loss_reason_name: 'Deixou de responder',
        loss_notes: 'Cadência concluída sem resposta',
        job_title: 'Coordenador',
      },
    };
    render(
      <CallSidePanel
        activity={lostActivity}
        dialerProvider="api4com"
        minimized={false}
        onMinimize={vi.fn()}
        onRestore={vi.fn()}
        onClose={vi.fn()}
        onMarkDone={vi.fn()}
        onSkip={vi.fn()}
        onLeadLost={vi.fn()}
        onScheduled={vi.fn()}
        history={FIXTURE_HISTORY}
        schedulingPreview={FIXTURE_PREVIEW}
        leadCardEnabled
        cardNow={new Date('2026-11-11T15:00:00.000Z')}
      />,
    );

    expect(screen.getByTestId('call-lead-card')).toBeTruthy();
    expect(screen.getByText('EnriqueceAI')).toBeTruthy();
    const brand = screen.getByTestId('call-lead-brand');
    expect(brand.querySelector('[data-src]')?.getAttribute('data-src')).toBe('/logos/logo-ea-red.png');
    expect(brand.querySelector('[data-height]')?.getAttribute('data-height')).toBe('18');
    expect(screen.getByTestId('call-lead-card').textContent?.toLowerCase()).not.toContain('company');
    const email = screen.getByTestId('lead-card-email');
    expect(email.querySelectorAll('span')).toHaveLength(2);
    expect(email.querySelector('span')?.textContent).toBe('contato.fixture');
    expect(email.querySelector('p[title]')?.getAttribute('title')).toBe('contato.fixture@example.com');
    expect(screen.getByTestId('call-lead-attempt').textContent).toBe('TENTATIVA 3/3');
    const leadName = screen.getByRole('heading', { name: 'Contato de Teste' });
    expect(leadName.className).toContain('uppercase');
    expect(leadName.className).toContain('font-black');
    expect(screen.getByTestId('lead-card-telefone').textContent).toContain('11900000000');
    expect(screen.getByTestId('lead-card-cargo').textContent).toContain('Coordenador');
    expect(screen.getByTestId('lead-card-temperatura').textContent).toContain('perdido há 6,8 meses');
    expect(screen.getByTestId('lead-card-temperatura').textContent).not.toMatch(/quente|morno|frio/i);
    expect(screen.queryByTestId('lead-card-sdr')).toBeNull();
    expect(screen.getByTestId('call-lead-opening').textContent).toContain('Seria um problema retomarmos em 2 minutos?');
    expect(screen.queryByText('Enriquecido')).toBeNull();
    expect(screen.getByText('Perguntar quem decide e se já houve contato anterior. Fixture.')).toBeTruthy();
    expect(screen.getByTestId('call-history-collapse')).toBeTruthy();
    expect(screen.getByText('Respondeu · e-mail')).toBeTruthy();

    expect(screen.getByTestId('phone-dock').getAttribute('data-layout')).toBe('dock');
    expect(screen.getByRole('button', { name: 'Minimizar painel' })).toBeTruthy();
    expect(screen.getByLabelText('Anotações')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desqualificar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Agendar reunião' }));
    expect(screen.getByTestId('slot-0-14')).toBeTruthy();
    expect(listClosers).not.toHaveBeenCalled();
    expect(scheduleMeeting).not.toHaveBeenCalled();
  });
});
