import { describe, expect, it } from 'vitest';

import type { ActivityLead } from '../types';

import { getAllLeadPhones, resolveWhatsAppPhone } from './resolve-whatsapp-phone';

// Minimal lead factory — only the fields the resolver reads matter; the rest is
// cast away to keep the fixtures focused.
function makeLead(partial: Partial<ActivityLead>): ActivityLead {
  return {
    socios: null,
    phones: null,
    telefone: null,
    ...partial,
  } as ActivityLead;
}

describe('getAllLeadPhones', () => {
  it('resolves a normal sócio WhatsApp number', () => {
    const lead = makeLead({
      socios: [
        {
          nome: 'João Silva',
          celulares: [{ ddd: 11, numero: '999998888', whatsapp: true, ranking: 1 }],
        },
      ],
    });

    const phones = getAllLeadPhones(lead);
    expect(phones).toHaveLength(1);
    expect(phones[0]?.raw).toBe('5511999998888');
    expect(phones[0]?.source).toBe('socio_whatsapp');
  });

  it('does not throw when a sócio celular has no numero (malformed JSONB)', () => {
    const lead = makeLead({
      socios: [
        {
          nome: 'Maria Souza',
          // `numero` missing — enrichment JSONB shape is not guaranteed at runtime
          celulares: [{ ddd: 11, whatsapp: true, ranking: 1 } as unknown as {
            ddd: number;
            numero: string;
            whatsapp: boolean;
            ranking: number;
          }],
        },
      ],
    });

    expect(() => getAllLeadPhones(lead)).not.toThrow();
    // Malformed entry is skipped, not surfaced as an empty phone.
    expect(getAllLeadPhones(lead)).toHaveLength(0);
  });

  it('skips celulares with null/empty numero but keeps valid ones', () => {
    const lead = makeLead({
      socios: [
        {
          nome: 'Carlos Lima',
          celulares: [
            { ddd: 11, numero: null as unknown as string, whatsapp: false, ranking: 1 },
            { ddd: 21, numero: '988887777', whatsapp: false, ranking: 2 },
          ],
        },
      ],
    });

    const phones = getAllLeadPhones(lead);
    expect(phones).toHaveLength(1);
    expect(phones[0]?.raw).toBe('5521988887777');
  });

  it('falls back to lead.telefone when no sócio numbers exist', () => {
    const lead = makeLead({ telefone: '(11) 3333-2222' });
    const phones = getAllLeadPhones(lead);
    expect(phones).toHaveLength(1);
    expect(phones[0]?.source).toBe('lead_telefone');
  });

  it('labels a landline lead.telefone as "Fixo empresa"', () => {
    const phones = getAllLeadPhones(makeLead({ telefone: '(11) 3333-2222' }));
    expect(phones[0]?.label).toContain('(Fixo empresa)');
  });

  it('labels a mobile lead.telefone as "Celular" (digit pattern, not hardcoded)', () => {
    const phones = getAllLeadPhones(makeLead({ telefone: '11954958486' }));
    expect(phones[0]?.label).toContain('(Celular)');
  });
});

describe('resolveWhatsAppPhone', () => {
  it('returns null when the lead has no phones at all', () => {
    expect(resolveWhatsAppPhone(makeLead({}))).toBeNull();
  });

  it('returns null (no crash) when the only celular is malformed', () => {
    const lead = makeLead({
      socios: [
        {
          nome: 'Ana',
          celulares: [{ ddd: 11, whatsapp: true, ranking: 1 } as unknown as {
            ddd: number;
            numero: string;
            whatsapp: boolean;
            ranking: number;
          }],
        },
      ],
    });
    expect(() => resolveWhatsAppPhone(lead)).not.toThrow();
    expect(resolveWhatsAppPhone(lead)).toBeNull();
  });
});
