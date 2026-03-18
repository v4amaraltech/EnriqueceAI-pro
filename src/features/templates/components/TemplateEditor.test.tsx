import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MessageTemplateRow } from '../../cadences/types';
import { TemplateEditor } from './TemplateEditor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('../actions/manage-templates', () => ({
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
}));

vi.mock('./TemplatePreviewPanel', () => ({
  TemplatePreviewPanel: ({ subject, body }: { subject?: string; body: string }) => (
    <div data-testid="template-preview-panel">
      {subject && <div>{subject}</div>}
      <div>{body}</div>
    </div>
  ),
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

describe('TemplateEditor', () => {
  it('should render new template form', () => {
    render(<TemplateEditor />);
    expect(screen.getByText('Novo Template')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome do template')).toBeInTheDocument();
    expect(screen.getByLabelText('Canal')).toBeInTheDocument();
    expect(screen.getByLabelText('Corpo da mensagem')).toBeInTheDocument();
  });

  it('should render edit template form with data', () => {
    render(<TemplateEditor template={createTemplate()} />);
    expect(screen.getByText('Editar Template')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Primeiro Contato')).toBeInTheDocument();
  });

  it('should show subject field for email channel', () => {
    render(<TemplateEditor template={createTemplate()} />);
    expect(screen.getByLabelText('Assunto')).toBeInTheDocument();
  });

  it('should show system badge for system templates', () => {
    render(<TemplateEditor template={createTemplate({ is_system: true })} />);
    expect(screen.getByText('Sistema (somente leitura)')).toBeInTheDocument();
  });

  it('should disable inputs for system templates', () => {
    render(<TemplateEditor template={createTemplate({ is_system: true })} />);
    expect(screen.getByLabelText('Nome do template')).toBeDisabled();
    expect(screen.getByLabelText('Corpo da mensagem')).toBeDisabled();
  });

  it('should show available variables', () => {
    render(<TemplateEditor />);
    expect(screen.getByText('Variáveis do Lead')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '{{primeiro_nome}}' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '{{empresa}}' })).toBeInTheDocument();
  });

  it('should show preview button', () => {
    render(<TemplateEditor />);
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('should toggle preview on click', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor template={createTemplate()} />);

    await user.click(screen.getByText('Preview'));
    expect(screen.getByText('Ocultar Preview')).toBeInTheDocument();
  });

  it('should show "Criar Template" button for new templates', () => {
    render(<TemplateEditor />);
    expect(screen.getByText('Criar Template')).toBeInTheDocument();
  });

  it('should show "Salvar" button for editing templates', () => {
    render(<TemplateEditor template={createTemplate()} />);
    expect(screen.getByText('Salvar')).toBeInTheDocument();
  });

  it('should not show save button for system templates', () => {
    render(<TemplateEditor template={createTemplate({ is_system: true })} />);
    expect(screen.queryByText('Salvar')).not.toBeInTheDocument();
    expect(screen.queryByText('Criar Template')).not.toBeInTheDocument();
  });
});
