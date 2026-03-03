import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}));

const mockCreateNotifications = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: (...args: unknown[]) => mockCreateNotifications(...args),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { AIService } from './ai.service';
import type { GenerateMessageRequest, LeadContext } from '../types';

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
  socios: [{ nome: 'João Silva', qualificacao: 'Sócio-Administrador' }],
};

function createMockSupabase() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  };
  return {
    from: vi.fn(() => chain),
    _chain: chain,
  };
}

function createMockServiceSupabase() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  };
  return {
    from: vi.fn(() => chain),
    _chain: chain,
  };
}

function mockFetchResponse(body: string, subject?: string) {
  const responseBody = subject
    ? `{"subject": "${subject}", "body": "${body}"}`
    : `{"body": "${body}"}`;

  return {
    content: [{ type: 'text', text: responseBody }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('AIService', () => {
  let supabase: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateNotifications.mockClear();
    supabase = createMockSupabase();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    // Mock fetch for Claude API
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('generateMessage', () => {
    it('should generate email message with subject', async () => {
      const request: GenerateMessageRequest = {
        channel: 'email',
        tone: 'professional',
        leadContext: mockLead,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFetchResponse('Olá TechCorp, gostaria de apresentar...', 'Proposta para TechCorp')),
      } as Response);

      const result = await AIService.generateMessage(request, 'org-1');

      expect(result.subject).toBe('Proposta para TechCorp');
      expect(result.body).toBe('Olá TechCorp, gostaria de apresentar...');
      expect(result.tokensUsed).toBe(150);
    });

    it('should generate whatsapp message without subject', async () => {
      const request: GenerateMessageRequest = {
        channel: 'whatsapp',
        tone: 'direct',
        leadContext: mockLead,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFetchResponse('Olá! Vi que a TechCorp está em crescimento.')),
      } as Response);

      const result = await AIService.generateMessage(request, 'org-1');

      expect(result.subject).toBeUndefined();
      expect(result.body).toBe('Olá! Vi que a TechCorp está em crescimento.');
    });

    it('should call Claude API with correct headers', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key-123';

      const request: GenerateMessageRequest = {
        channel: 'email',
        tone: 'professional',
        leadContext: mockLead,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFetchResponse('Test body', 'Test subject')),
      } as Response);

      await AIService.generateMessage(request, 'org-1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-key-123',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
    });

    it('should throw error when API key is missing', async () => {
      process.env.ANTHROPIC_API_KEY = '';

      const request: GenerateMessageRequest = {
        channel: 'email',
        tone: 'professional',
        leadContext: mockLead,
      };

      await expect(AIService.generateMessage(request, 'org-1')).rejects.toThrow(
        'ANTHROPIC_API_KEY não configurada',
      );
    });

    it('should throw error when Claude API returns error', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      const request: GenerateMessageRequest = {
        channel: 'email',
        tone: 'professional',
        leadContext: mockLead,
      };

      await expect(AIService.generateMessage(request, 'org-1')).rejects.toThrow(
        'Claude API error (500)',
      );
    });

    it('should handle response wrapped in markdown code blocks', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: '```json\n{"subject": "Test", "body": "Hello"}\n```' }],
          usage: { input_tokens: 50, output_tokens: 30 },
        }),
      } as Response);

      const request: GenerateMessageRequest = {
        channel: 'email',
        tone: 'professional',
        leadContext: mockLead,
      };

      const result = await AIService.generateMessage(request, 'org-1');
      expect(result.subject).toBe('Test');
      expect(result.body).toBe('Hello');
    });
  });

  describe('getUsage', () => {
    it('should return default usage when no record exists', async () => {
      const usage = await AIService.getUsage('org-1');
      expect(usage.used).toBe(0);
      expect(usage.limit).toBe(50);
      expect(usage.remaining).toBe(50);
    });

    it('should return existing usage data', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 30, daily_limit: 50 },
      });

      const usage = await AIService.getUsage('org-1');
      expect(usage.used).toBe(30);
      expect(usage.limit).toBe(50);
      expect(usage.remaining).toBe(20);
    });

    it('should return unlimited when daily_limit is -1', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 100, daily_limit: -1 },
      });

      const usage = await AIService.getUsage('org-1');
      expect(usage.used).toBe(100);
      expect(usage.limit).toBe(-1);
      expect(usage.remaining).toBe(-1);
    });
  });

  describe('checkRateLimit', () => {
    it('should throw when limit reached', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 50, daily_limit: 50 },
      });

      await expect(AIService.checkRateLimit('org-1')).rejects.toThrow(
        'Limite diário de gerações de IA atingido',
      );
    });

    it('should not throw when limit not reached', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 10, daily_limit: 50 },
      });

      await expect(AIService.checkRateLimit('org-1')).resolves.not.toThrow();
    });

    it('should not throw when limit is unlimited (-1)', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 9999, daily_limit: -1 },
      });

      await expect(AIService.checkRateLimit('org-1')).resolves.not.toThrow();
    });
  });

  describe('incrementUsage', () => {
    it('should create new record when none exists', async () => {
      // First call for select (maybeSingle returns null)
      supabase._chain.maybeSingle.mockResolvedValueOnce({ data: null });

      await AIService.incrementUsage('org-1');

      expect(supabase.from).toHaveBeenCalledWith('ai_usage');
      expect(supabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: 'org-1',
          generation_count: 1,
          daily_limit: 50,
        }),
      );
    });

    it('should update existing record', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 5, daily_limit: 50 },
      });

      await AIService.incrementUsage('org-1');

      expect(supabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ generation_count: 6 }),
      );
    });
  });

  describe('incrementUsage — threshold alerts', () => {
    let serviceSupabase: ReturnType<typeof createMockServiceSupabase>;

    beforeEach(() => {
      serviceSupabase = createMockServiceSupabase();
      vi.mocked(createServiceRoleClient).mockReturnValue(serviceSupabase as never);
    });

    it('should fire 80% threshold alert when crossing threshold', async () => {
      // count=39, limit=50 → threshold=40. After increment: 40 >= 40 → fires
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 39, daily_limit: 50 },
      });

      // Service role dedup check: no existing notification
      serviceSupabase._chain.maybeSingle.mockResolvedValueOnce({ data: null });

      await AIService.incrementUsage('org-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          type: 'usage_limit_alert',
          metadata: expect.objectContaining({ channel: 'ai', used: 40, limit: 50 }),
          roleFilter: 'manager',
        }),
      );
    });

    it('should NOT fire alert when not crossing threshold', async () => {
      // count=10, limit=50 → threshold=40. After increment: 11 < 40 → no alert
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 10, daily_limit: 50 },
      });

      await AIService.incrementUsage('org-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should NOT fire alert when already above threshold', async () => {
      // count=45, limit=50 → threshold=40. 45 >= 40 already → no crossing
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 45, daily_limit: 50 },
      });

      await AIService.incrementUsage('org-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should NOT fire alert when limit is unlimited', async () => {
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 100, daily_limit: -1 },
      });

      await AIService.incrementUsage('org-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should deduplicate: skip alert if already sent today', async () => {
      // Crosses threshold
      supabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'usage-1', generation_count: 39, daily_limit: 50 },
      });

      // Dedup: notification already exists today
      serviceSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'existing-notification' },
      });

      await AIService.incrementUsage('org-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should NOT fire alert when creating new record (count=1)', async () => {
      // No existing record → insert with count=1
      supabase._chain.maybeSingle.mockResolvedValueOnce({ data: null });

      await AIService.incrementUsage('org-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });
  });
});
