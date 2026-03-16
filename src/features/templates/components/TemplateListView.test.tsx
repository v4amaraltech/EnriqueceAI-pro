import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MessageTemplateRow } from '../../cadences/types';
import { TemplateListView } from './TemplateListView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../actions/manage-templates', () => ({
  deleteTemplate: vi.fn(),
  duplicateTemplate: vi.fn(),
}));

function createTemplate(overrides: Partial<MessageTemplateRow> = {}): MessageTemplateRow {
  return {
    id: 'tmpl-1',
    org_id: 'org-1',
    name: 'Primeiro Contato',
    channel: 'email',
    subject: 'Olá {{nome_fantasia}}',
    body: 'Corpo do email com {{razao_social}}',
    variables_used: ['nome_fantasia', 'razao_social'],
    is_system: false,
    created_by: 'user-1',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    ...overrides,
  };
}

const defaultUserMap: Record<string, string> = { 'user-1': 'João Silva' };

describe('TemplateListView', () => {
  it('should render template list header', () => {
    render(
      <TemplateListView
        templates={[createTemplate()]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    expect(screen.getByText('Templates de Mensagem')).toBeInTheDocument();
    expect(screen.getByText('1 template')).toBeInTheDocument();
  });

  it('should render template name in table', () => {
    render(
      <TemplateListView
        templates={[createTemplate()]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    expect(screen.getByText('Primeiro Contato')).toBeInTheDocument();
  });

  it('should show channel badge', () => {
    render(
      <TemplateListView
        templates={[createTemplate()]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    // "Email" appears in both the tab filter and the badge
    expect(screen.getAllByText('Email').length).toBeGreaterThanOrEqual(2);
  });

  it('should show system badge for system templates', () => {
    render(
      <TemplateListView
        templates={[createTemplate({ is_system: true })]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    expect(screen.getByText('Sistema')).toBeInTheDocument();
  });

  it('should show responsible name from userMap', () => {
    render(
      <TemplateListView
        templates={[createTemplate()]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    expect(screen.getByText('João Silva')).toBeInTheDocument();
  });

  it('should show empty state when no templates', () => {
    render(
      <TemplateListView
        templates={[]}
        total={0}
        page={1}
        perPage={20}
        userMap={{}}
      />,
    );
    expect(screen.getByText('Nenhum template encontrado')).toBeInTheDocument();
  });

  it('should show WhatsApp channel for WhatsApp templates', () => {
    render(
      <TemplateListView
        templates={[createTemplate({ channel: 'whatsapp', subject: null })]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    // "WhatsApp" appears in both the tab filter and the badge
    expect(screen.getAllByText('WhatsApp').length).toBeGreaterThanOrEqual(2);
  });

  it('should show "Novo Template" button', () => {
    render(
      <TemplateListView
        templates={[createTemplate()]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    expect(screen.getByText('Novo Template')).toBeInTheDocument();
  });

  it('should show filter tabs', () => {
    render(
      <TemplateListView
        templates={[createTemplate()]}
        total={1}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    // "Todos" appears in both the tab and the select filter
    expect(screen.getAllByText('Todos').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tab', { name: 'Todos' })).toBeInTheDocument();
  });

  it('should show plural count for multiple templates', () => {
    render(
      <TemplateListView
        templates={[createTemplate(), createTemplate({ id: 'tmpl-2', name: 'Follow Up' })]}
        total={2}
        page={1}
        perPage={20}
        userMap={defaultUserMap}
      />,
    );
    expect(screen.getByText('2 templates')).toBeInTheDocument();
  });
});
