import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Api4ComConnectionSafe, CalendarConnectionSafe, GmailConnectionSafe, WhatsAppConnectionSafe } from '../types';
import { IntegrationsView } from './IntegrationsView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

vi.mock('../actions/manage-gmail', () => ({
  getGmailAuthUrl: vi.fn(),
  disconnectGmail: vi.fn(),
}));

vi.mock('../hooks/useEvolutionWhatsApp', () => ({
  useEvolutionWhatsApp: () => ({
    step: 'idle' as const,
    qrBase64: null,
    phone: null,
    error: null,
    connect: vi.fn(),
    refreshQr: vi.fn(),
  }),
}));


const gmailConnected: GmailConnectionSafe = {
  id: 'gmail-1',
  email_address: 'user@gmail.com',
  custom_signature: null,
  status: 'connected',
  created_at: '2026-02-15T10:00:00Z',
  updated_at: '2026-02-15T10:00:00Z',
};

const _whatsappConnected: WhatsAppConnectionSafe = {
  id: 'wa-1',
  phone_number_id: '123456789',
  business_account_id: 'BA-987',
  status: 'connected',
  created_at: '2026-02-15T10:00:00Z',
  updated_at: '2026-02-15T10:00:00Z',
};

const calendarConnected: CalendarConnectionSafe = {
  id: 'cal-1',
  calendar_email: 'user@gmail.com',
  status: 'connected',
  created_at: '2026-02-15T10:00:00Z',
  updated_at: '2026-02-15T10:00:00Z',
};

const api4comConnected: Api4ComConnectionSafe = {
  id: 'voip-1',
  ramal: '1014',
  base_url: 'https://api.api4com.com/api/v1/',
  has_api_key: true,
  status: 'connected',
  created_at: '2026-02-15T10:00:00Z',
  updated_at: '2026-02-15T10:00:00Z',
};

const defaultProps = { gmail: null, whatsapp: null, crm: null, calendar: null, api4com: null, evolutionInstance: null };

describe('IntegrationsView', () => {
  it('should render integrations header', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText('Integrações')).toBeInTheDocument();
  });

  it('should show unified Google card with description', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText(/sincronizar e gerenciar seus compromissos/)).toBeInTheDocument();
  });

  it('should show single "Conectar Google" button when not connected', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText('Conectar Google')).toBeInTheDocument();
  });

  it('should show WhatsApp card', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('should show email address when Gmail connected', () => {
    render(<IntegrationsView {...defaultProps} gmail={gmailConnected} />);
    expect(screen.getByText(/user@gmail\.com/)).toBeInTheDocument();
  });

  it('should show connected status for Google', () => {
    render(<IntegrationsView {...defaultProps} gmail={gmailConnected} />);
    expect(screen.getAllByText('Conectado').length).toBeGreaterThanOrEqual(1);
  });

  it('should show disconnect button when Google connected', () => {
    render(<IntegrationsView {...defaultProps} gmail={gmailConnected} />);
    expect(screen.getAllByText('Desconectar').length).toBeGreaterThanOrEqual(1);
  });

  it('should show WhatsApp description when not connected', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText(/Integre o WhatsApp para acessar/)).toBeInTheDocument();
  });

  it('should show error status for Google when Gmail has error', () => {
    render(
      <IntegrationsView
        {...defaultProps}
        gmail={{ ...gmailConnected, status: 'error' }}
      />,
    );
    expect(screen.getByText('Erro')).toBeInTheDocument();
  });

  it('should show connected status when only calendar connected', () => {
    render(<IntegrationsView {...defaultProps} calendar={calendarConnected} />);
    expect(screen.getByText(/user@gmail\.com/)).toBeInTheDocument();
    expect(screen.getAllByText('Conectado').length).toBeGreaterThanOrEqual(1);
  });

  it('should show single email when both Gmail and Calendar connected', () => {
    render(
      <IntegrationsView
        {...defaultProps}
        gmail={gmailConnected}
        calendar={calendarConnected}
      />,
    );
    expect(screen.getByText(/user@gmail\.com/)).toBeInTheDocument();
    expect(screen.getAllByText('Conectado').length).toBeGreaterThanOrEqual(1);
  });

  it('should show error status for Google when calendar has error', () => {
    render(
      <IntegrationsView
        {...defaultProps}
        calendar={{ ...calendarConnected, status: 'error' }}
      />,
    );
    expect(screen.getAllByText('Erro').length).toBeGreaterThanOrEqual(1);
  });

  it('should show API4Com card with description', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText('API4Com')).toBeInTheDocument();
    expect(screen.getByText(/Integração automática com sistema de ligações/)).toBeInTheDocument();
  });

  it('should show connect buttons when not connected', () => {
    render(<IntegrationsView {...defaultProps} />);
    expect(screen.getByText('Conectar WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Conectar API4Com')).toBeInTheDocument();
    expect(screen.getByText('Conectar Google')).toBeInTheDocument();
  });

  it('should show ramal and Gerenciar button when API4Com connected', () => {
    render(<IntegrationsView {...defaultProps} api4com={api4comConnected} />);
    expect(screen.getByText(/Ramal 1014/)).toBeInTheDocument();
    expect(screen.getByText('Gerenciar')).toBeInTheDocument();
  });

  it('should show connected status for API4Com', () => {
    render(<IntegrationsView {...defaultProps} api4com={api4comConnected} />);
    expect(screen.getAllByText('Conectado').length).toBeGreaterThanOrEqual(1);
  });

  it('should show error status for API4Com when error', () => {
    render(
      <IntegrationsView
        {...defaultProps}
        api4com={{ ...api4comConnected, status: 'error' }}
      />,
    );
    expect(screen.getAllByText('Erro').length).toBeGreaterThanOrEqual(1);
  });

});
