import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RDStationAdapter } from './rdstation.adapter';
import type { CrmCredentials } from '../types/crm';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('RDStationAdapter', () => {
  let adapter: RDStationAdapter;
  const mockCredentials: CrmCredentials = {
    access_token: 'test-api-token',
    api_key: 'test-api-token',
  };

  beforeEach(() => {
    adapter = new RDStationAdapter();
    vi.clearAllMocks();
  });

  it('should have provider set to rdstation', () => {
    expect(adapter.provider).toBe('rdstation');
  });

  describe('getAuthUrl', () => {
    it('should return empty string (no OAuth)', () => {
      expect(adapter.getAuthUrl('http://localhost:3000/callback')).toBe('');
    });
  });

  describe('exchangeCode', () => {
    it('should throw error (not supported)', async () => {
      await expect(
        adapter.exchangeCode('code', 'http://localhost:3000/callback'),
      ).rejects.toThrow('RD Station CRM uses API token authentication, not OAuth');
    });
  });

  describe('refreshToken', () => {
    it('should return credentials unchanged', async () => {
      const result = await adapter.refreshToken(mockCredentials);
      expect(result).toBe(mockCredentials);
    });
  });

  describe('validateConnection', () => {
    it('should return true for valid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'pipe-1', name: 'Default' }],
      });
      expect(await adapter.validateConnection(mockCredentials)).toBe(true);
      expect(mockFetch.mock.calls[0]![0]).toContain('/deal_pipelines');
      expect(mockFetch.mock.calls[0]![0]).toContain('token=test-api-token');
    });

    it('should return false for invalid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Unauthorized',
      });
      expect(await adapter.validateConnection(mockCredentials)).toBe(false);
    });
  });

  describe('pullContacts', () => {
    it('should pull and map contacts from RD CRM', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contacts: [
            {
              id: 'rd-contact-1',
              name: 'Test Contact',
              emails: [{ email: 'test@example.com' }],
              phones: [{ phone: '11999990000' }],
              organization: { id: 'org-1', name: 'Test Corp' },
              updated_at: '2026-02-19T10:00:00Z',
            },
          ],
          has_more: false,
          total: 1,
        }),
      });

      const contacts = await adapter.pullContacts(mockCredentials);
      expect(contacts).toHaveLength(1);
      expect(contacts[0]!.external_id).toBe('rd-contact-1');
      expect(contacts[0]!.email).toBe('test@example.com');
      expect(contacts[0]!.phone).toBe('11999990000');
      expect(contacts[0]!.company_name).toBe('Test Corp');
    });

    it('should handle contacts without optional fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contacts: [
            {
              id: 'rd-contact-2',
              name: 'No Details',
              updated_at: '2026-02-19T10:00:00Z',
            },
          ],
          has_more: false,
          total: 1,
        }),
      });

      const contacts = await adapter.pullContacts(mockCredentials);
      expect(contacts[0]!.email).toBeNull();
      expect(contacts[0]!.phone).toBeNull();
      expect(contacts[0]!.company_name).toBeNull();
    });
  });

  describe('pushContact', () => {
    it('should create new contact', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-rd-contact' }),
      });

      const result = await adapter.pushContact(
        mockCredentials,
        { nome_fantasia: 'Empresa', email: 'test@test.com', telefone: '11999990000' },
        { nome_fantasia: 'name', email: 'email', telefone: 'phone' },
      );
      expect(result.external_id).toBe('new-rd-contact');

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.name).toBe('Empresa');
      expect(callBody.emails).toEqual([{ email: 'test@test.com' }]);
      expect(callBody.phones).toEqual([{ phone: '11999990000' }]);
    });

    it('should update existing contact', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'existing-id' }),
      });

      const result = await adapter.pushContact(
        mockCredentials,
        { nome_fantasia: 'Updated' },
        { nome_fantasia: 'name' },
        'existing-id',
      );
      expect(result.external_id).toBe('existing-id');
      expect(mockFetch.mock.calls[0]![0]).toContain('/contacts/existing-id');
      expect(mockFetch.mock.calls[0]![1]!.method).toBe('PUT');
    });
  });

  describe('pushActivity', () => {
    it('should return noop external_id', async () => {
      const result = await adapter.pushActivity(mockCredentials, {
        contact_external_id: 'rd-contact-1',
        type: 'email',
        subject: 'Follow up',
        body: 'Test body',
        timestamp: '2026-02-19T10:00:00Z',
      });
      expect(result.external_id).toMatch(/^noop_/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('fetchPipelines', () => {
    it('should fetch and map pipelines', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'pipe-1', name: 'Sales Pipeline' },
          { id: 'pipe-2', name: 'Enterprise Pipeline' },
        ],
      });

      const pipelines = await adapter.fetchPipelines(mockCredentials);
      expect(pipelines).toHaveLength(2);
      expect(pipelines[0]).toEqual({ id: 'pipe-1', name: 'Sales Pipeline' });
    });
  });

  describe('fetchStages', () => {
    it('should fetch and map stages for a pipeline', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deal_stages: [
            { id: 'stage-1', name: 'Qualificação', nickname: 'qual', order: 1 },
            { id: 'stage-2', name: 'Proposta', nickname: 'prop', order: 2 },
          ],
        }),
      });

      const stages = await adapter.fetchStages(mockCredentials, 'pipe-1');
      expect(stages).toHaveLength(2);
      expect(stages[0]).toEqual({ id: 'stage-1', name: 'Qualificação', order: 1 });
      expect(mockFetch.mock.calls[0]![0]).toContain('deal_pipeline_id=pipe-1');
    });
  });

  describe('pushOrganization', () => {
    it('should create organization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'org-123', name: 'Test Corp' }),
      });

      const result = await adapter.pushOrganization(mockCredentials, {
        name: 'Test Corp',
      });
      expect(result.external_id).toBe('org-123');
    });
  });

  describe('pushDeal', () => {
    it('should create deal with contacts and stage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'deal-456', name: 'New Deal' }),
      });

      const result = await adapter.pushDeal(mockCredentials, {
        name: 'New Deal',
        deal_stage_id: 'stage-1',
        contacts: ['contact-1', 'contact-2'],
        organization_id: 'org-123',
      });
      expect(result.external_id).toBe('deal-456');

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.name).toBe('New Deal');
      expect(callBody.deal_stage_id).toBe('stage-1');
      expect(callBody.contacts).toEqual([{ _id: 'contact-1' }, { _id: 'contact-2' }]);
      expect(callBody.organization).toEqual({ id: 'org-123' });
    });

    it('should create deal without organization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'deal-789' }),
      });

      await adapter.pushDeal(mockCredentials, {
        name: 'Simple Deal',
        deal_stage_id: 'stage-1',
        contacts: ['contact-1'],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.organization).toBeUndefined();
    });
  });
});
