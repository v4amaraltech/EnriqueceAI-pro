import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

vi.mock('@/lib/auth/require-manager', () => ({
  isManager: vi.fn().mockResolvedValue(false),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let interactionsChain: ReturnType<typeof createChainMock>;
let cadencesChain: ReturnType<typeof createChainMock>;
let leadsChain: ReturnType<typeof createChainMock>;
let enrollmentsChain: ReturnType<typeof createChainMock>;
let goalsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'interactions') return interactionsChain;
        if (table === 'cadences') return cadencesChain;
        if (table === 'leads') return leadsChain;
        if (table === 'cadence_enrollments') return enrollmentsChain;
        if (table === 'daily_activity_goals') return goalsChain;
        return createChainMock();
      },
    });
  }),
}));

import { fetchDailyProgress } from './fetch-daily-progress';

/** Helper: N interações reais (sem cadência automática). */
function rows(n: number, cadenceId: string | null = null) {
  return Array.from({ length: n }, (_, i) => ({ id: `int-${i}`, cadence_id: cadenceId }));
}

describe('fetchDailyProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    interactionsChain = createChainMock();
    cadencesChain = createChainMock();
    leadsChain = createChainMock();
    enrollmentsChain = createChainMock();
    goalsChain = createChainMock();
    // No assigned leads → pending path short-circuits to 0 (chunkedIn returns []).
    (leadsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    // Sem cadências auto_email por padrão: a chain default (eq→chain) faz o await
    // resolver `undefined` → autoEmailCadenceIds vazio. Nada a mockar aqui.
  });

  it('should return error when user has no org', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });

    const result = await fetchDailyProgress();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return progress with default target when no goal exists', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: rows(5) });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })  // user-specific
      .mockResolvedValueOnce({ data: null }); // org default

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completed).toBe(5);
      expect(result.data.pending).toBe(0);
      expect(result.data.total).toBe(5);
      expect(result.data.target).toBe(20); // default
    }
  });

  it('excludes imported/manual notes and failed sends from the completed count', async () => {
    // Regressão: uma carga de notas do CRM legado (channel='research',
    // is_note=true) inflou "feitas hoje" de 19 → 213 p/ um SDR que fez 19.
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: rows(19) });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: null });

    const result = await fetchDailyProgress();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.completed).toBe(19);
    // Envio falho não é toque concluído.
    expect(interactionsChain.neq).toHaveBeenCalledWith('type', 'failed');
    // Nota (importada ou manual) excluída, de forma null-safe.
    expect(interactionsChain.or).toHaveBeenCalledWith(
      'metadata->>is_note.is.null,metadata->>is_note.neq.true',
    );
    // Régua de reunião (meeting_reminder) também excluída (disparo automático).
    expect(interactionsChain.or).toHaveBeenCalledWith(
      'metadata->>meeting_reminder.is.null,metadata->>meeting_reminder.neq.true',
    );
  });

  it('exclui e-mails de cadência automática (auto_email) do completed', async () => {
    // Vinicius viu "36 feitas" sem fazer nada: 34 eram e-mails da cadência
    // "Inbound — E-mail (auto)" (type=auto_email), enviados pelo motor.
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    // cadences: .select().eq('org_id').eq('type') → 1º eq encadeia, 2º resolve.
    (cadencesChain.eq as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(cadencesChain)
      .mockResolvedValueOnce({ data: [{ id: 'auto-1' }] });
    // 3 automáticas (auto-1) + 1 manual (std-1) + 1 avulsa (sem cadência) = 2 reais.
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { id: 'a', cadence_id: 'auto-1' },
        { id: 'b', cadence_id: 'auto-1' },
        { id: 'c', cadence_id: 'auto-1' },
        { id: 'd', cadence_id: 'std-1' },
        { id: 'e', cadence_id: null },
      ],
    });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: null });

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.completed).toBe(2);
  });

  it('should return user-specific goal target', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: rows(3) });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    // User has specific goal (org default also fetched in parallel — user wins)
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { target: 30 } })
      .mockResolvedValueOnce({ data: { target: 20 } });

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target).toBe(30);
    }
  });

  it('should fallback to org default goal when no user goal', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    // No user goal, but org default exists
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })      // user-specific
      .mockResolvedValueOnce({ data: { target: 15 } }); // org default

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target).toBe(15);
    }
  });

  it('includePending:false (página de Atividades) não consulta leads nem inscrições', async () => {
    // A página usa o tamanho da fila como "pendentes" — a conta daqui era jogada fora.
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: rows(3) });
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { target: 30 } }) // user-specific
      .mockResolvedValueOnce({ data: { target: 20 } }); // org default

    const result = await fetchDailyProgress(undefined, { includePending: false });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ completed: 3, pending: 0, total: 3, target: 30 });
    }
    expect(leadsChain.select).not.toHaveBeenCalled();
    expect(enrollmentsChain.select).not.toHaveBeenCalled();
  });

  it('meta da org vale quando o SDR não tem meta própria', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { target: 25 } });

    const result = await fetchDailyProgress(undefined, { includePending: false });
    expect(result.success && result.data.target).toBe(25);
  });
});
