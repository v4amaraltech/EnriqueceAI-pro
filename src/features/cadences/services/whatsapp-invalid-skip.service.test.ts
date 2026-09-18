import { beforeEach, describe, expect, it, vi } from 'vitest';

const leadEvent = vi.hoisted(() => ({ logLeadEvent: vi.fn() }));
const loss = vi.hoisted(() => ({ markLeadLostOnCadenceEnd: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => leadEvent);
vi.mock('./cadence-end-loss.service', () => loss);

import {
  classifyInvalidWhatsAppStep,
  nextNonWhatsAppStep,
  skipWhatsAppStepsForInvalidLeads,
  WHATSAPP_SCAN_LIMIT,
  WHATSAPP_SKIP_BATCH,
} from './whatsapp-invalid-skip.service';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

const RECOVERY_STEPS = [
  { step_order: 1, channel: 'phone' },
  { step_order: 2, channel: 'whatsapp' },
  { step_order: 3, channel: 'phone' },
  { step_order: 4, channel: 'whatsapp' },
  { step_order: 5, channel: 'phone' },
  { step_order: 6, channel: 'phone' },
  { step_order: 7, channel: 'whatsapp' },
];

describe('nextNonWhatsAppStep', () => {
  it('passo atual de WhatsApp: devolve o próximo de outro canal', () => {
    expect(nextNonWhatsAppStep(RECOVERY_STEPS, 2)).toBe(3);
    expect(nextNonWhatsAppStep(RECOVERY_STEPS, 4)).toBe(5);
  });

  it('pula uma sequência de WhatsApp até achar outro canal', () => {
    const steps = [
      { step_order: 1, channel: 'whatsapp' },
      { step_order: 2, channel: 'whatsapp' },
      { step_order: 3, channel: 'whatsapp' },
      { step_order: 4, channel: 'email' },
    ];
    expect(nextNonWhatsAppStep(steps, 1)).toBe(4);
  });

  it('último passo é WhatsApp: não há para onde ir', () => {
    expect(nextNonWhatsAppStep(RECOVERY_STEPS, 7)).toBeNull();
  });

  it('passo atual não é WhatsApp: não mexe', () => {
    expect(nextNonWhatsAppStep(RECOVERY_STEPS, 3)).toBeNull();
  });

  it('passo fora da faixa (sobra de edição de cadência): não mexe', () => {
    expect(nextNonWhatsAppStep(RECOVERY_STEPS, 10)).toBeNull();
  });
});

describe('classifyInvalidWhatsAppStep', () => {
  it('passo de WhatsApp com outro canal adiante: avança', () => {
    expect(classifyInvalidWhatsAppStep(RECOVERY_STEPS, 2)).toEqual({ action: 'advance', toStep: 3 });
  });

  it('cauda só de WhatsApp: fim de cadência', () => {
    expect(classifyInvalidWhatsAppStep(RECOVERY_STEPS, 7)).toEqual({ action: 'end' });
  });

  it('passo atual não é WhatsApp, ou fora da faixa: nada a fazer', () => {
    expect(classifyInvalidWhatsAppStep(RECOVERY_STEPS, 3)).toEqual({ action: 'none' });
    expect(classifyInvalidWhatsAppStep(RECOVERY_STEPS, 99)).toEqual({ action: 'none' });
  });
});

interface Captured {
  table: string;
  payload: Record<string, unknown>;
  filters: string[];
}

let captured: Captured[];
let candidates: Array<{ id: string; cadence_id: string; lead_id: string; current_step: number; org_id: string }>;
let stepRows: Array<{ cadence_id: string; step_order: number; channel: string }>;
let updateError: { message: string } | null;
let selects: string[];
let filtersUsed: string[];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const filters: string[] = [];
  let isUpdate = false;

  chain.select = vi.fn((cols: string) => {
    selects.push(`${table}:${cols}`);
    return chain;
  });
  const passthrough = (name: string) =>
    vi.fn((...args: unknown[]) => {
      const f = `${name}:${String(args[0])}`;
      filters.push(f);
      filtersUsed.push(`${table}.${f}`);
      return chain;
    });
  chain.eq = passthrough('eq');
  chain.not = passthrough('not');
  chain.in = passthrough('in');
  chain.limit = vi.fn(() => chain);
  chain.order = vi.fn((col: string) => {
    filtersUsed.push(`${table}.order:${col}`);
    return chain;
  });
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    isUpdate = true;
    captured.push({ table, payload, filters });
    return chain;
  });

  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (isUpdate) result = { data: null, error: updateError };
    else if (table === 'cadence_enrollments') result = { data: candidates, error: null };
    else if (table === 'cadence_steps') result = { data: stepRows, error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  return chain;
}

const supabase = { from: (t: string) => makeChain(t) } as never;

beforeEach(() => {
  vi.clearAllMocks();
  captured = [];
  selects = [];
  filtersUsed = [];
  updateError = null;
  candidates = [
    { id: 'enr-1', cadence_id: 'cad-1', lead_id: 'lead-1', current_step: 2, org_id: ORG },
  ];
  stepRows = RECOVERY_STEPS.map((s) => ({ cadence_id: 'cad-1', ...s }));
  leadEvent.logLeadEvent.mockResolvedValue(undefined);
  loss.markLeadLostOnCadenceEnd.mockResolvedValue({ lost: true, reasonName: 'Deixou de responder' });
});

describe('skipWhatsAppStepsForInvalidLeads', () => {
  it('avança o passo e registra na timeline', async () => {
    const result = await skipWhatsAppStepsForInvalidLeads(supabase);

    expect(result).toEqual({ scanned: 1, advanced: 1, ended: 0 });
    expect(captured[0]?.table).toBe('cadence_enrollments');
    expect(captured[0]?.payload).toEqual({ current_step: 3 });
    // trava otimista: só avança se o passo não mudou no meio do caminho
    expect(captured[0]?.filters).toContain('eq:current_step');
    expect(leadEvent.logLeadEvent).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        event: 'step_skipped_whatsapp_invalid',
        userId: null,
        metadata: expect.objectContaining({ from_step: 2, to_step: 3, enrollment_id: 'enr-1' }),
      }),
    );
  });

  it('só olha inscrição ativa de lead marcado, com teto por execução', async () => {
    await skipWhatsAppStepsForInvalidLeads(supabase);

    expect(filtersUsed).toContain('cadence_enrollments.eq:status');
    expect(filtersUsed).toContain('cadence_enrollments.not:lead.whatsapp_invalid_at');
    expect(selects.some((s) => s.includes('leads!inner'))).toBe(true);
    // lê em lote grande e ordenado (senão varre sempre as mesmas inscrições),
    // mas escreve no máximo WHATSAPP_SKIP_BATCH por execução
    expect(filtersUsed).toContain('cadence_enrollments.order:enrolled_at');
    expect(WHATSAPP_SKIP_BATCH).toBe(50);
    expect(WHATSAPP_SCAN_LIMIT).toBeGreaterThan(WHATSAPP_SKIP_BATCH);
  });

  it('respeita o teto de avanços por execução', async () => {
    candidates = Array.from({ length: WHATSAPP_SKIP_BATCH + 20 }, (_, i) => ({
      id: `enr-${i}`,
      cadence_id: 'cad-1',
      lead_id: `lead-${i}`,
      current_step: 2,
      org_id: ORG,
    }));

    const result = await skipWhatsAppStepsForInvalidLeads(supabase);

    expect(result.advanced).toBe(WHATSAPP_SKIP_BATCH);
    expect(captured).toHaveLength(WHATSAPP_SKIP_BATCH);
  });

  it('cauda só de WhatsApp: encerra e chama a regra de Perdido', async () => {
    candidates = [{ id: 'enr-2', cadence_id: 'cad-1', lead_id: 'lead-2', current_step: 7, org_id: ORG }];

    const result = await skipWhatsAppStepsForInvalidLeads(supabase);

    expect(result).toEqual({ scanned: 1, advanced: 0, ended: 1 });
    expect(captured[0]?.payload).toMatchObject({ status: 'completed' });
    // trava dupla: só encerra se continuar ativa no mesmo passo
    expect(captured[0]?.filters).toContain('eq:status');
    expect(captured[0]?.filters).toContain('eq:current_step');
    expect(leadEvent.logLeadEvent).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        event: 'cadence_completed',
        message: expect.stringContaining('só restavam passos de WhatsApp'),
        metadata: expect.objectContaining({ reason: 'whatsapp_invalid_tail', last_step: 7 }),
      }),
    );
    expect(loss.markLeadLostOnCadenceEnd).toHaveBeenCalledWith({
      orgId: ORG,
      leadId: 'lead-2',
      cadenceId: 'cad-1',
      enrollmentId: 'enr-2',
    });
  });

  it('encerra ANTES de chamar a regra de Perdido (senão ela se bloqueia)', async () => {
    candidates = [{ id: 'enr-2', cadence_id: 'cad-1', lead_id: 'lead-2', current_step: 7, org_id: ORG }];

    await skipWhatsAppStepsForInvalidLeads(supabase);

    const encerrou = captured.findIndex((c) => c.payload.status === 'completed');
    expect(encerrou).toBe(0);
    expect(loss.markLeadLostOnCadenceEnd).toHaveBeenCalledTimes(1);
  });

  it('falha ao encerrar não chama a regra de Perdido', async () => {
    candidates = [{ id: 'enr-2', cadence_id: 'cad-1', lead_id: 'lead-2', current_step: 7, org_id: ORG }];
    updateError = { message: 'boom' };

    const result = await skipWhatsAppStepsForInvalidLeads(supabase);

    expect(result).toEqual({ scanned: 1, advanced: 0, ended: 0 });
    expect(loss.markLeadLostOnCadenceEnd).not.toHaveBeenCalled();
  });

  it('passo atual não é WhatsApp: não mexe', async () => {
    candidates = [{ id: 'enr-3', cadence_id: 'cad-1', lead_id: 'lead-3', current_step: 5, org_id: ORG }];

    expect(await skipWhatsAppStepsForInvalidLeads(supabase)).toEqual({ scanned: 1, advanced: 0, ended: 0 });
    expect(captured).toHaveLength(0);
  });

  it('falha no UPDATE não gera evento nem quebra o motor', async () => {
    updateError = { message: 'boom' };

    const result = await skipWhatsAppStepsForInvalidLeads(supabase);

    expect(result).toEqual({ scanned: 1, advanced: 0, ended: 0 });
    expect(leadEvent.logLeadEvent).not.toHaveBeenCalled();
  });

  it('nenhum candidato: no-op', async () => {
    candidates = [];
    expect(await skipWhatsAppStepsForInvalidLeads(supabase)).toEqual({ scanned: 0, advanced: 0, ended: 0 });
  });

  it('erro inesperado é engolido (motor segue)', async () => {
    const quebrado = { from: () => { throw new Error('sem conexão'); } } as never;
    expect(await skipWhatsAppStepsForInvalidLeads(quebrado)).toEqual({ scanned: 0, advanced: 0, ended: 0 });
  });
});
