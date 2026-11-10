import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchLeadChannelPage = vi.fn();

vi.mock('./read', () => ({
  fetchLeadChannelPage: (...args: unknown[]) => fetchLeadChannelPage(...args),
}));

import { TooltipProvider } from '@/shared/components/ui/tooltip';

import { ChannelChat } from './ChannelChat';

const LEAD = '11111111-1111-4111-8111-111111111111';
const peer = { name: 'Roberta Viviane', address: '11945705316', chips: ['Qualificado'] };

function renderChat(channel: 'whatsapp' | 'email') {
  return render(
    <TooltipProvider>
      <ChannelChat leadId={LEAD} channel={channel} peer={peer} senderName="Vinicius" />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  fetchLeadChannelPage.mockReset();
});

describe('ChannelChat', () => {
  it('mostra bolha da resposta à esquerda e o estado único do que enviamos', async () => {
    fetchLeadChannelPage.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        hasMore: false,
        cursor: null,
        messages: [
          {
            id: 'a',
            channel: 'whatsapp',
            direction: 'out',
            text: 'Oi',
            missingBody: false,
            createdAt: '2026-11-10T15:00:00.000Z',
            delivery: 'Entregue',
            deliveryTick: 'delivered',
            threadId: null,
            subject: null,
            aiGenerated: false,
          },
          {
            id: 'b',
            channel: 'whatsapp',
            direction: 'in',
            text: 'Resposta detectada, texto não gravado',
            missingBody: true,
            createdAt: '2026-11-10T16:00:00.000Z',
            delivery: null,
            threadId: null,
            subject: null,
            aiGenerated: false,
          },
        ],
      },
    });
    const { container } = renderChat('whatsapp');
    expect(await screen.findByText('Oi')).toBeInTheDocument();
    expect(screen.getByText('Roberta Viviane')).toBeInTheDocument();
    expect(screen.getByText('+55 (11) 94570-5316')).toBeInTheDocument();
    expect(screen.getByText('Qualificado')).toBeInTheDocument();
    expect(screen.getByText('Resposta detectada, texto não gravado')).toBeInTheDocument();
    expect(screen.getByLabelText('Entregue')).toBeInTheDocument();
    const outbound = container.querySelector('[data-direction="out"]');
    const inbound = container.querySelector('[data-direction="in"]');
    expect(outbound?.className).toContain('bg-zinc-900');
    expect(outbound?.className).not.toContain('bg-primary');
    expect(inbound?.className).toContain('bg-white');
    const composer = screen.getByLabelText('Responder como Vinicius...');
    expect(composer).toBeDisabled();
    expect(composer).toHaveAttribute('title', expect.stringContaining('Envio livre desligado'));
    expect(screen.queryByText('As respostas do lead aparecem aqui quando a captura do WhatsApp estiver ligada.')).toBeNull();
    expect(container.querySelector('[data-mail-card]')).toBeNull();
  });

  it('avisa com discrição quando só há mensagens nossas', async () => {
    fetchLeadChannelPage.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        hasMore: false,
        cursor: null,
        messages: [{
          id: 'a',
          channel: 'whatsapp',
          direction: 'out',
          text: 'Número sem WhatsApp. Nenhum texto foi enviado.',
          html: null,
          missingBody: true,
          createdAt: '2026-08-10T21:07:00.000Z',
          delivery: 'Falhou',
          deliveryTick: 'failed',
          threadId: null,
          subject: null,
          aiGenerated: false,
        }],
      },
    });
    renderChat('whatsapp');
    expect(await screen.findByText('Número sem WhatsApp. Nenhum texto foi enviado.')).toBeInTheDocument();
    expect(screen.getByLabelText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('As respostas do lead aparecem aqui quando a captura do WhatsApp estiver ligada.')).toBeInTheDocument();
    expect(screen.queryByText('WhatsApp de solicitação de feedback enviado para Vinicius Mercante')).toBeNull();
  });

  it('mostra o e-mail em cartão, com parágrafos, assinatura e link', async () => {
    fetchLeadChannelPage.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        hasMore: false,
        cursor: null,
        messages: [{
          id: 'mail-1',
          channel: 'email',
          direction: 'out',
          text: 'Olá Sandro, tudo bem? Att, Vinicius Mercante',
          html: '<p>Olá Sandro, tudo bem?</p><p>Cheguei até você pesquisando.</p><p>Att,<br><strong>Vinicius Mercante</strong><br>Gerente de Receita<br><a href="https://v4company.com">https://v4company.com</a></p><script>alert(1)</script><img src="https://evil.test/a.png" alt="foto">',
          missingBody: false,
          createdAt: '2026-11-10T11:13:00.000Z',
          delivery: 'Enviada',
          threadId: 'th-1',
          subject: 'Gazin Tech + V4 Company (Reunião)',
          aiGenerated: false,
        }],
      },
    });
    const { container } = renderChat('email');
    expect(await screen.findByRole('heading', { name: 'Gazin Tech + V4 Company (Reunião)' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Gazin Tech + V4 Company (Reunião)' })).toHaveLength(1);
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Olá Sandro, tudo bem?')).toBeInTheDocument();
    expect(screen.getByText('Cheguei até você pesquisando.')).toBeInTheDocument();
    expect(screen.getByText('Vinicius Mercante').tagName).toBe('STRONG');
    const link = screen.getByRole('link', { name: 'https://v4company.com' });
    expect(link).toHaveAttribute('href', 'https://v4company.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const card = container.querySelector('[data-mail-card]');
    expect(card?.className).toContain('bg-card');
    expect(card?.className).not.toContain('bg-primary');
    expect(container.innerHTML).not.toMatch(/<script|onerror|evil\.test/i);
  });

  it('agrupa o e-mail pelo assunto e pede a página anterior', async () => {
    fetchLeadChannelPage
      .mockResolvedValueOnce({
        success: true,
        data: {
          enabled: true,
          hasMore: true,
          cursor: { createdAt: '2026-11-10T15:00:00.000Z', id: '22222222-2222-4222-8222-222222222222' },
          messages: [{
            id: '22222222-2222-4222-8222-222222222222',
            channel: 'email',
            direction: 'out',
            text: 'Segue a proposta',
            missingBody: false,
            createdAt: '2026-11-10T15:00:00.000Z',
            delivery: 'Enviada',
            threadId: 'th-1',
            subject: 'Proposta',
            aiGenerated: false,
          }],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          enabled: true,
          hasMore: false,
          cursor: { createdAt: '2026-11-09T15:00:00.000Z', id: '33333333-3333-4333-8333-333333333333' },
          messages: [{
            id: '33333333-3333-4333-8333-333333333333',
            channel: 'email',
            direction: 'out',
            text: 'Primeiro contato',
            missingBody: false,
            createdAt: '2026-11-09T15:00:00.000Z',
            delivery: 'Enviada',
            threadId: 'th-0',
            subject: 'Primeiro contato',
            aiGenerated: false,
            html: null,
          }],
        },
      });
    const user = userEvent.setup();
    renderChat('email');
    expect(await screen.findByRole('heading', { name: 'Proposta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByRole('heading', { name: 'Primeiro contato' })).toBeInTheDocument();
    expect(fetchLeadChannelPage).toHaveBeenLastCalledWith({
      leadId: LEAD,
      channel: 'email',
      before: { createdAt: '2026-11-10T15:00:00.000Z', id: '22222222-2222-4222-8222-222222222222' },
    });
  });
});
