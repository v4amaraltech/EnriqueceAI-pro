import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/generate-message', () => ({
  generateMessageAction: vi.fn(),
  getAIUsageAction: vi.fn(),
}));

import { generateMessageAction, getAIUsageAction } from '../actions/generate-message';

import type { LeadContext } from '../types';
import { AIMessageGenerator } from './AIMessageGenerator';

const mockLead: LeadContext = {
  nome_fantasia: 'TechCorp',
  razao_social: 'TechCorp LTDA',
  cnpj: '11222333000181',
  email: 'contato@techcorp.com',
  telefone: '(11) 99999-0000',
  porte: 'ME',
  cnae: '6201-5/01',
  situacao_cadastral: 'Ativa',
  faturamento_estimado: 500000,
  endereco: { cidade: 'São Paulo', uf: 'SP' },
  socios: [{ nome: 'João', qualificacao: 'Sócio' }],
};

describe('AIMessageGenerator', () => {
  it('should render dialog when open', () => {
    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );
    expect(screen.getByText('Gerar Mensagem com IA')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(
      <AIMessageGenerator open={false} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );
    expect(screen.queryByText('Gerar Mensagem com IA')).not.toBeInTheDocument();
  });

  it('should show channel and tone selectors', () => {
    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );
    expect(screen.getByText('Canal')).toBeInTheDocument();
    expect(screen.getByText('Tom')).toBeInTheDocument();
  });

  it('should show lead context preview', () => {
    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );
    expect(screen.getByText('TechCorp')).toBeInTheDocument();
    expect(screen.getByText('ME')).toBeInTheDocument();
    expect(screen.getByText('São Paulo/SP')).toBeInTheDocument();
  });

  it('should show generate button', () => {
    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );
    expect(screen.getByText('Gerar Mensagem')).toBeInTheDocument();
  });

  it('should show additional context textarea', () => {
    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );
    expect(screen.getByText('Contexto adicional (opcional)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Oferecer desconto/)).toBeInTheDocument();
  });

  it('should show generated message after successful generation', async () => {
    const user = userEvent.setup();

    vi.mocked(generateMessageAction).mockResolvedValueOnce({
      success: true,
      data: { subject: 'Proposta TechCorp', body: 'Olá TechCorp!', tokensUsed: 100 },
    });
    vi.mocked(getAIUsageAction).mockResolvedValueOnce({
      success: true,
      data: { used: 1, limit: 50, remaining: 49 },
    });

    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );

    await user.click(screen.getByText('Gerar Mensagem'));

    expect(await screen.findByText('Mensagem Gerada')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Proposta TechCorp')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Olá TechCorp!')).toBeInTheDocument();
  });

  it('should show action buttons after generation', async () => {
    const user = userEvent.setup();

    vi.mocked(generateMessageAction).mockResolvedValueOnce({
      success: true,
      data: { body: 'Mensagem gerada', tokensUsed: 50 },
    });
    vi.mocked(getAIUsageAction).mockResolvedValueOnce({
      success: true,
      data: { used: 1, limit: 50, remaining: 49 },
    });

    render(
      <AIMessageGenerator
        open={true}
        onOpenChange={vi.fn()}
        leadContext={mockLead}
        onSaveAsTemplate={vi.fn()}
      />,
    );

    await user.click(screen.getByText('Gerar Mensagem'));

    expect(await screen.findByText('Regenerar')).toBeInTheDocument();
    expect(screen.getByText('Copiar')).toBeInTheDocument();
    expect(screen.getByText('Usar no Template')).toBeInTheDocument();
  });

  it('should show usage info after generation', async () => {
    const user = userEvent.setup();

    vi.mocked(generateMessageAction).mockResolvedValueOnce({
      success: true,
      data: { body: 'Test', tokensUsed: 50 },
    });
    vi.mocked(getAIUsageAction).mockResolvedValueOnce({
      success: true,
      data: { used: 5, limit: 50, remaining: 45 },
    });

    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );

    await user.click(screen.getByText('Gerar Mensagem'));

    expect(await screen.findByText(/5 \/ 50 gerações/)).toBeInTheDocument();
    expect(screen.getByText(/45 restantes/)).toBeInTheDocument();
  });

  it('should show error toast on failure', async () => {
    const user = userEvent.setup();

    vi.mocked(generateMessageAction).mockResolvedValueOnce({
      success: false,
      error: 'Limite diário atingido',
    });

    render(
      <AIMessageGenerator open={true} onOpenChange={vi.fn()} leadContext={mockLead} />,
    );

    await user.click(screen.getByText('Gerar Mensagem'));

    // Verify generate button still shows (message not generated)
    expect(screen.queryByText('Mensagem Gerada')).not.toBeInTheDocument();
  });
});
