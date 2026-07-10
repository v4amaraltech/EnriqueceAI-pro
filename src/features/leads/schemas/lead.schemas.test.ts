import { describe, expect, it } from 'vitest';

import { cnpjSchema, createLeadSchema, leadFiltersSchema } from './lead.schemas';

const validUserId = '550e8400-e29b-41d4-a716-446655440000';
const validCadenceId = '660e8400-e29b-41d4-a716-446655440000';

const validInput = {
  first_name: 'João',
  last_name: 'Silva',
  email: 'joao@empresa.com',
  telefone: '11999999999',
  empresa: 'Acme Ltda',
  job_title: 'Gerente Comercial',
  segmento: 'Tecnologia',
  lead_source: 'outbound',
  assigned_to: validUserId,
};

describe('lead schemas', () => {
  describe('cnpjSchema', () => {
    it('should accept a valid CNPJ', () => {
      const result = cnpjSchema.safeParse('11222333000181');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('11222333000181');
    });

    it('should accept and strip formatted CNPJ', () => {
      const result = cnpjSchema.safeParse('11.222.333/0001-81');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('11222333000181');
    });

    it('should reject empty string', () => {
      const result = cnpjSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('should reject invalid CNPJ', () => {
      const result = cnpjSchema.safeParse('11222333000199');
      expect(result.success).toBe(false);
    });
  });

  describe('createLeadSchema', () => {
    it('should accept valid input with all required fields', () => {
      const result = createLeadSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input with cadence and scheduling', () => {
      const result = createLeadSchema.safeParse({
        ...validInput,
        cadence_id: validCadenceId,
        enrollment_mode: 'scheduled',
        scheduled_start: '2026-03-01T09:00:00.000Z',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enrollment_mode).toBe('scheduled');
        expect(result.data.scheduled_start).toBe('2026-03-01T09:00:00.000Z');
      }
    });

    it('should default enrollment_mode to immediate', () => {
      const result = createLeadSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.enrollment_mode).toBe('immediate');
    });

    it('should default is_inbound to false', () => {
      const result = createLeadSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.is_inbound).toBe(false);
    });

    it('should accept is_inbound true', () => {
      const result = createLeadSchema.safeParse({ ...validInput, is_inbound: true });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.is_inbound).toBe(true);
    });

    it('should reject without first_name', () => {
      const { first_name: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject without last_name', () => {
      const { last_name: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject without email', () => {
      const { email: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = createLeadSchema.safeParse({ ...validInput, email: 'not-email' });
      expect(result.success).toBe(false);
    });

    it('should reject without telefone', () => {
      const { telefone: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject without empresa', () => {
      const { empresa: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject without job_title', () => {
      const { job_title: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject without lead_source', () => {
      const { lead_source: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should accept custom lead_source values', () => {
      const result = createLeadSchema.safeParse({ ...validInput, lead_source: 'Leadbroker' });
      expect(result.success).toBe(true);
    });

    it('should reject empty lead_source', () => {
      const result = createLeadSchema.safeParse({ ...validInput, lead_source: '' });
      expect(result.success).toBe(false);
    });

    it('should reject without assigned_to', () => {
      const { assigned_to: _, ...rest } = validInput;
      const result = createLeadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should accept empty string for optional cadence_id', () => {
      const result = createLeadSchema.safeParse({ ...validInput, cadence_id: '' });
      expect(result.success).toBe(true);
    });

    it('should accept all valid lead_source values', () => {
      const sources = ['outbound', 'leadbroker', 'blackbox', 'indicacao', 'recomendacao', 'apollo', 'reativacao', 'recuperacao'];
      for (const source of sources) {
        const result = createLeadSchema.safeParse({ ...validInput, lead_source: source });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('leadFiltersSchema', () => {
    it('should accept empty filters with defaults', () => {
      const result = leadFiltersSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.per_page).toBe(25);
      }
    });

    it('should accept valid status filter', () => {
      const result = leadFiltersSchema.safeParse({ status: 'new' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = leadFiltersSchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should coerce page number from string', () => {
      const result = leadFiltersSchema.safeParse({ page: '3' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.page).toBe(3);
    });

    it('should reject per_page above 100', () => {
      const result = leadFiltersSchema.safeParse({ per_page: 200 });
      expect(result.success).toBe(false);
    });

    it('should drop junk uuid filters (?assigned_to=undefined) instead of crashing the query', () => {
      const result = leadFiltersSchema.safeParse({ assigned_to: 'undefined', cadence_id: 'undefined' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assigned_to).toBeUndefined();
        expect(result.data.cadence_id).toBeUndefined();
      }
    });

    it('should keep valid uuid and sentinel values for uuid filters', () => {
      const uuid = '11111111-2222-3333-4444-555555555555';
      const result = leadFiltersSchema.safeParse({ assigned_to: uuid, cadence_id: '__none__' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assigned_to).toBe(uuid);
        expect(result.data.cadence_id).toBe('__none__');
      }
      const unassigned = leadFiltersSchema.safeParse({ assigned_to: '__unassigned__' });
      expect(unassigned.success).toBe(true);
      if (unassigned.success) expect(unassigned.data.assigned_to).toBe('__unassigned__');
    });
  });
});
