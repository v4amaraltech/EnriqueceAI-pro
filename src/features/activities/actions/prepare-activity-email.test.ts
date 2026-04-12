import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'vendedor@test.com',
              user_metadata: { full_name: 'João Vendedor' },
            },
          },
        }),
      },
    },
  })),
}));

const mockPersonalizeMessage = vi.fn();
vi.mock('@/features/ai/services/ai.service', () => ({
  AIService: {
    personalizeMessage: (...args: unknown[]) => mockPersonalizeMessage(...args),
  },
}));

import { prepareActivityEmail } from './prepare-activity-email';

import type { ActivityLead } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockLead: ActivityLead = {
  id: 'lead-1',
  org_id: 'org-1',
  nome_fantasia: 'Empresa ABC',
  razao_social: 'ABC Ltda',
  cnpj: '11222333000181',
  email: 'contato@abc.com',
  telefone: '11999990000',
  municipio: 'São Paulo',
  uf: 'SP',
  porte: 'ME',
  primeiro_nome: 'João',
  socios: null,
  endereco: null,
  instagram: null,
  linkedin: null,
  website: null,
  status: null,
  enrichment_status: null,
  notes: null,
  fit_score: null,
  engagement_score: null,
  is_inbound: false,
  created_at: '2026-01-15T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prepareActivityEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success with empty to when lead has no email', async () => {
    const result = await prepareActivityEmail({
      lead: { ...mockLead, email: null },
      templateSubject: 'Olá',
      templateBody: 'Corpo',
      aiPersonalization: false,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.to).toBe('');
    expect(result.data.body).toBe('Corpo');
  });

  it('should return empty body when no template body provided', async () => {
    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: 'Assunto fixo',
      templateBody: null,
      aiPersonalization: false,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.to).toBe('contato@abc.com');
    expect(result.data.subject).toBe('Assunto fixo');
    expect(result.data.body).toBe('');
    expect(result.data.aiPersonalized).toBe(false);
  });

  it('should render template variables in subject and body', async () => {
    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: 'Olá {{nome_fantasia}}',
      templateBody: 'Prezada {{nome_fantasia}}, CNPJ {{cnpj}}, de {{municipio}}/{{uf}}.',
      aiPersonalization: false,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.subject).toBe('Olá Empresa ABC');
    expect(result.data.body).toBe('Prezada Empresa ABC, CNPJ 11222333000181, de São Paulo/SP.');
    expect(result.data.aiPersonalized).toBe(false);
  });

  it('should apply AI personalization when enabled', async () => {
    mockPersonalizeMessage.mockResolvedValue({
      subject: 'Assunto IA',
      body: 'Corpo personalizado pela IA',
      tokensUsed: 150,
    });

    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: 'Olá {{nome_fantasia}}',
      templateBody: 'Template base {{nome_fantasia}}',
      aiPersonalization: true,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.subject).toBe('Assunto IA');
    expect(result.data.body).toBe('Corpo personalizado pela IA');
    expect(result.data.aiPersonalized).toBe(true);
    expect(mockPersonalizeMessage).toHaveBeenCalledWith(
      'email',
      'Template base Empresa ABC', // rendered template
      expect.objectContaining({
        nome_fantasia: 'Empresa ABC',
        cnpj: '11222333000181',
      }),
      'org-1',
    );
  });

  it('should fall back to template when AI personalization fails', async () => {
    mockPersonalizeMessage.mockRejectedValue(new Error('Rate limit exceeded'));

    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: 'Olá {{nome_fantasia}}',
      templateBody: 'Corpo para {{nome_fantasia}}',
      aiPersonalization: true,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.body).toBe('Corpo para Empresa ABC');
    expect(result.data.aiPersonalized).toBe(false);
  });

  it('should not call AI when aiPersonalization is false', async () => {
    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: 'Assunto',
      templateBody: 'Corpo simples',
      aiPersonalization: false,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    expect(mockPersonalizeMessage).not.toHaveBeenCalled();
  });

  it('should handle subject-only template (no subject in template)', async () => {
    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: null,
      templateBody: 'Corpo para {{nome_fantasia}}',
      aiPersonalization: false,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.subject).toBe('');
    expect(result.data.body).toBe('Corpo para Empresa ABC');
  });

  it('should keep AI subject only when AI returns one', async () => {
    mockPersonalizeMessage.mockResolvedValue({
      body: 'Corpo IA',
      tokensUsed: 100,
      // no subject returned
    });

    const result = await prepareActivityEmail({
      lead: mockLead,
      templateSubject: 'Assunto original {{nome_fantasia}}',
      templateBody: 'Template {{nome_fantasia}}',
      aiPersonalization: true,
      channel: 'email',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Subject should remain the rendered template version since AI didn't override
    expect(result.data.subject).toBe('Assunto original Empresa ABC');
    expect(result.data.body).toBe('Corpo IA');
    expect(result.data.aiPersonalized).toBe(true);
  });
});
