import { describe, expect, it } from 'vitest';

import { createActivityTemplateSchema, updateActivityTemplateSchema } from './index';

describe('createActivityTemplateSchema', () => {
  it('accepts valid template', () => {
    const result = createActivityTemplateSchema.safeParse({
      name: 'Ligação de Qualificação',
      channel: 'phone',
    });
    expect(result.success).toBe(true);
  });

  it('defaults instructions to empty string', () => {
    const result = createActivityTemplateSchema.parse({
      name: 'Template',
      channel: 'email',
    });
    expect(result.instructions).toBe('');
  });

  it('rejects empty name', () => {
    const result = createActivityTemplateSchema.safeParse({ name: '', channel: 'phone' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 100 chars', () => {
    const result = createActivityTemplateSchema.safeParse({ name: 'a'.repeat(101), channel: 'phone' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = createActivityTemplateSchema.safeParse({ name: 'Test', channel: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid channels', () => {
    for (const channel of ['email', 'whatsapp', 'phone', 'linkedin', 'research']) {
      const result = createActivityTemplateSchema.safeParse({ name: 'Test', channel });
      expect(result.success, `channel '${channel}' should be valid`).toBe(true);
    }
  });

  it('rejects instructions over 5000 chars', () => {
    const result = createActivityTemplateSchema.safeParse({
      name: 'Test',
      channel: 'phone',
      instructions: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe('updateActivityTemplateSchema', () => {
  it('accepts partial update with name only', () => {
    const result = updateActivityTemplateSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('accepts partial update with instructions only', () => {
    const result = updateActivityTemplateSchema.safeParse({ instructions: 'New instructions' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = updateActivityTemplateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
