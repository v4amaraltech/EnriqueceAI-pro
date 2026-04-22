import { describe, expect, it } from 'vitest';

import { inboundLeadSchema, inboundLeadBatchSchema, createApiKeySchema } from './inbound-lead.schemas';

describe('inboundLeadSchema', () => {
  const validLead = {
    first_name: 'João',
    email: 'joao@empresa.com',
    telefone: '11999998888',
    empresa: 'Empresa LTDA',
  };

  it('accepts valid lead with required fields', () => {
    const result = inboundLeadSchema.safeParse(validLead);
    expect(result.success).toBe(true);
  });

  it('defaults is_inbound to true', () => {
    const result = inboundLeadSchema.parse(validLead);
    expect(result.is_inbound).toBe(true);
  });

  it('rejects missing first_name', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, first_name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, email: 'not-email' });
    expect(result.success).toBe(false);
  });

  it('rejects missing telefone', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, telefone: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing empresa', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, empresa: '' });
    expect(result.success).toBe(false);
  });

  it('accepts valid CNPJ', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, cnpj: '12345678000195' });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = inboundLeadSchema.safeParse({
      ...validLead,
      last_name: 'Silva',
      job_title: 'CEO',
      lead_source: 'Google Ads',
      canal: 'Inbound',
      assigned_to: '550e8400-e29b-41d4-a716-446655440000',
      cadence_id: '550e8400-e29b-41d4-a716-446655440001',
      custom_fields: { field1: 'value1', field2: 42 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid assigned_to UUID', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, assigned_to: 'not-uuid' });
    expect(result.success).toBe(false);
  });

  it('accepts empty string for linkedin/website', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, linkedin: '', website: '' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid linkedin URL', () => {
    const result = inboundLeadSchema.safeParse({ ...validLead, linkedin: 'not-a-url' });
    expect(result.success).toBe(false);
  });
});

describe('inboundLeadBatchSchema', () => {
  const validLead = {
    first_name: 'João',
    email: 'joao@empresa.com',
    telefone: '11999998888',
    empresa: 'Empresa LTDA',
  };

  it('accepts batch with 1 lead', () => {
    const result = inboundLeadBatchSchema.safeParse({ leads: [validLead] });
    expect(result.success).toBe(true);
  });

  it('defaults on_duplicate to skip', () => {
    const result = inboundLeadBatchSchema.parse({ leads: [validLead] });
    expect(result.on_duplicate).toBe('skip');
  });

  it('rejects empty leads array', () => {
    const result = inboundLeadBatchSchema.safeParse({ leads: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 100 leads', () => {
    const leads = Array.from({ length: 101 }, (_, i) => ({
      ...validLead,
      email: `lead${i}@test.com`,
    }));
    const result = inboundLeadBatchSchema.safeParse({ leads });
    expect(result.success).toBe(false);
  });

  it('accepts on_duplicate update', () => {
    const result = inboundLeadBatchSchema.safeParse({ leads: [validLead], on_duplicate: 'update' });
    expect(result.success).toBe(true);
  });
});

describe('createApiKeySchema', () => {
  it('accepts valid name', () => {
    const result = createApiKeySchema.safeParse({ name: 'My API Key' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createApiKeySchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 100 chars', () => {
    const result = createApiKeySchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts valid expires_at', () => {
    const result = createApiKeySchema.safeParse({ name: 'Key', expires_at: '2026-12-31T23:59:59+00:00' });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for expires_at', () => {
    const result = createApiKeySchema.safeParse({ name: 'Key', expires_at: '' });
    expect(result.success).toBe(true);
  });
});
