import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/cadences/components/LeadTimeline', () => ({
  LeadTimeline: ({ entries }: { entries: { id: string }[] }) => <div>linha {entries.length}</div>,
}));
vi.mock('@/features/activities/components/ScheduleActivityForm', () => ({ ScheduleActivityForm: () => null }));
vi.mock('./LeadNotes', () => ({ LeadNotes: () => null }));
vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({ ScheduleMeetingModal: () => null }));
vi.mock('@/features/integrations/actions/schedule-meeting', () => ({ deleteMeeting: vi.fn() }));
vi.mock('@/features/integrations/meeting-invite-description', () => ({ descriptionFromMeetingRecord: () => '' }));
vi.mock('@/features/lead-channel-chat/ChannelChat', () => ({
  ChannelChat: ({ channel }: { channel: string }) => <div>conversa {channel}</div>,
}));

import type { LeadRow } from '../types';

import { LeadDetailTabs } from './LeadDetailTabs';

const lead = { id: 'lead-1', created_at: '2026-01-01T00:00:00Z', nome_fantasia: 'Acme' } as LeadRow;

describe('histórico com a conversa desligada e ligada', () => {
  it('mantém a linha do tempo quando a flag está desligada', async () => {
    const user = userEvent.setup();
    render(<LeadDetailTabs lead={lead} timeline={[]} showMeeting={false} onShowMeetingChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(screen.getByText(/linha/)).toBeInTheDocument();
    expect(screen.queryByText(/conversa/)).toBeNull();
  });

  it('troca WhatsApp e Email pela conversa quando a flag está ligada', async () => {
    const user = userEvent.setup();
    render(
      <LeadDetailTabs
        lead={lead}
        timeline={[]}
        showMeeting={false}
        onShowMeetingChange={vi.fn()}
        channelChatEnabled
      />,
    );
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(screen.getByText('conversa whatsapp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Email' }));
    expect(screen.getByText('conversa email')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ligação' }));
    expect(screen.getByText(/linha/)).toBeInTheDocument();
  });
});
