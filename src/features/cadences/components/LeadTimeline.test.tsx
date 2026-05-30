import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TimelineEntry } from '../cadences.contract';
import { LeadTimeline } from './LeadTimeline';

function createEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: 'int-1',
    type: 'sent',
    channel: 'email',
    message_content: 'Olá, tudo bem?',
    subject: null,
    html_body: null,
    ai_generated: false,
    is_note: false,
    created_at: '2026-02-15T10:00:00Z',
    ...overrides,
  };
}

describe('LeadTimeline', () => {
  it('should show empty state when no entries', () => {
    render(<LeadTimeline entries={[]} />);
    expect(screen.getByText('Nenhuma interação registrada ainda.')).toBeInTheDocument();
  });

  it('should show timeline header', () => {
    render(<LeadTimeline entries={[createEntry()]} />);
    expect(screen.getByText('Timeline de Atividades')).toBeInTheDocument();
  });

  it('should show channel name as title for email', () => {
    render(<LeadTimeline entries={[createEntry({ channel: 'email' })]} />);
    expect(screen.getByText('E-mail')).toBeInTheDocument();
  });

  it('should show channel name as title for whatsapp', () => {
    render(<LeadTimeline entries={[createEntry({ channel: 'whatsapp' })]} />);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('should show channel name with step number', () => {
    render(
      <LeadTimeline
        entries={[createEntry({ channel: 'email', step_order: 2 })]}
      />,
    );
    expect(screen.getByText('E-mail 2')).toBeInTheDocument();
  });

  it('should show message content', () => {
    render(<LeadTimeline entries={[createEntry({ message_content: 'Olá, tudo bem?' })]} />);
    expect(screen.getByText('Olá, tudo bem?')).toBeInTheDocument();
  });

  it('should show context-aware fallback when no content', () => {
    // Empty-content fallback is now channel-aware: an email with no body
    // renders the email-specific message instead of the generic "Nenhuma anotação".
    render(<LeadTimeline entries={[createEntry({ message_content: null })]} />);
    expect(screen.getByText('E-mail enviado (sem corpo registrado)')).toBeInTheDocument();
  });

  it('should show subject when available', () => {
    render(
      <LeadTimeline
        entries={[createEntry({ subject: 'Assunto do email' })]}
      />,
    );
    expect(screen.getByText('Assunto do email')).toBeInTheDocument();
  });

  it('should show "Anotação" for note entries', () => {
    render(
      <LeadTimeline
        entries={[createEntry({ is_note: true, channel: 'research', message_content: 'Caixa postal' })]}
      />,
    );
    expect(screen.getByText('Anotação')).toBeInTheDocument();
    expect(screen.getByText('Caixa postal')).toBeInTheDocument();
  });

  it('should render multiple entries', () => {
    const entries = [
      createEntry({ id: 'int-1', channel: 'email', step_order: 1 }),
      createEntry({ id: 'int-2', channel: 'linkedin', step_order: 2 }),
      createEntry({ id: 'int-3', channel: 'whatsapp', step_order: 3 }),
    ];
    render(<LeadTimeline entries={entries} />);
    expect(screen.getByText('E-mail 1')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn 2')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp 3')).toBeInTheDocument();
  });
});
