import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/leads', useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/cadences/components/LeadTimeline', () => ({
  LeadTimeline: () => <div>linha do tempo</div>,
}));
vi.mock('@/features/activities/components/ScheduleActivityForm', () => ({ ScheduleActivityForm: () => null }));
vi.mock('./LeadNotes', () => ({ LeadNotes: () => null }));
vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({ ScheduleMeetingModal: () => null }));
vi.mock('@/features/integrations/actions/schedule-meeting', () => ({ deleteMeeting: vi.fn() }));
vi.mock('@/features/integrations/meeting-invite-description', () => ({ descriptionFromMeetingRecord: () => '' }));

import type { LeadRow } from '../types';

import { InlineEditField } from './InlineEditField';
import { LeadDetailTabs } from './LeadDetailTabs';
import { MeetimeFieldRow } from './MeetimeFieldRow';

const lead = {
  id: 'lead-1',
  created_at: '2026-01-01T00:00:00Z',
  nome_fantasia: 'Acme',
} as LeadRow;

describe('superfícies que precisam de borda no escuro', () => {
  it('desenha o campo do lead com borda', () => {
    render(<MeetimeFieldRow label="Primeiro nome" value="Paula" />);
    expect(screen.getByText('Paula').parentElement?.className).toContain('border-border');
  });

  it('desenha o campo editável com borda antes do clique', () => {
    render(<InlineEditField leadId="lead-1" fieldKey="cargo" label="Cargo" value="Diretora" />);
    expect(screen.getByRole('button', { name: /Diretora/ }).className).toContain('border-border');
  });

  it('mantém o chip inativo com borda e texto do tema, no claro e no escuro', async () => {
    const user = userEvent.setup();
    render(
      <LeadDetailTabs lead={lead} timeline={[]} showMeeting={false} onShowMeetingChange={vi.fn()} />,
    );
    const whatsapp = screen.getByRole('button', { name: 'WhatsApp' });
    expect(whatsapp.className).toContain('dark:border-foreground/50');
    expect(whatsapp.className).toContain('text-foreground');
    expect(whatsapp).toHaveAttribute('aria-pressed', 'false');

    await user.click(whatsapp);
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tudo' }).className).toContain('border-border');
    expect(screen.getByText('linha do tempo')).toBeInTheDocument();
  });
});
