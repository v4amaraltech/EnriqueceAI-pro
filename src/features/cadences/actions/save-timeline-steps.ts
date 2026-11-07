'use server';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { ACTIVE_ENROLLMENTS_CODE } from '../types';
import type { CallProvider, ChannelType } from '../types';

export interface TimelineStepInput {
  /**
   * ID do passo já salvo. Quando presente (e pertence à cadência), o passo é
   * ATUALIZADO no lugar, preservando o ID — e com ele o vínculo das
   * interações (`interactions.step_id`) que dizem "este passo já foi feito".
   * Ausente ou desconhecido = passo novo.
   */
  id?: string;
  channel: ChannelType;
  delay_days: number;
  delay_hours?: number;
  step_order: number;
  template_id?: string | null;
  ai_personalization?: boolean;
  activity_name?: string | null;
  instructions?: string | null;
  call_provider?: CallProvider | null;
  /**
   * WhatsApp automático (story whatsapp-evolution-paced-sending). Ausente =
   * mantém o valor salvo; só vale para passo de WhatsApp com template.
   */
  auto_send?: boolean;
}

export interface SaveTimelineStepsOptions {
  /**
   * Confirma uma mudança ESTRUTURAL (inserir, remover ou reordenar passos)
   * mesmo havendo leads em andamento. Sem isso, a action devolve
   * `code = ACTIVE_ENROLLMENTS_CODE` e não grava nada — a tela mostra o
   * aviso e pede confirmação explícita do gestor.
   */
  confirmActiveEnrollments?: boolean;
}

export interface SaveTimelineStepsResult {
  saved: number;
  /** Passos que já existiam e mantiveram o ID. */
  preserved: number;
  created: number;
  removed: number;
}

interface ExistingStep {
  id: string;
  step_order: number;
  auto_send?: boolean | null;
}

// Reordenar passos no lugar esbarra no UNIQUE (cadence_id, step_order). Os
// passos mantidos passam por uma ordem temporária fora do intervalo real antes
// de receberem a ordem final.
const TEMP_ORDER_OFFSET = 10_000;

/**
 * Salva os passos da timeline de uma cadência padrão.
 *
 * Histórico: até 03/09/2026 esta action apagava TODOS os passos e recriava com
 * IDs novos. A FK `interactions.step_id` (ON DELETE SET NULL) zerava o vínculo
 * de milhares de interações e `current_step` (posicional) passava a apontar
 * para outra atividade — tarefas já feitas voltavam à fila dos SDRs como
 * atrasadas. Agora os passos existentes são atualizados no lugar (ID
 * preservado), só os removidos são apagados, e mudanças estruturais com
 * leads em andamento exigem confirmação.
 */
export async function saveTimelineSteps(
  cadenceId: string,
  steps: TimelineStepInput[],
  options: SaveTimelineStepsOptions = {},
): Promise<ActionResult<SaveTimelineStepsResult>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Verify cadence belongs to org and is editable
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  if (cadence.status !== 'draft' && cadence.status !== 'paused') {
    return { success: false, error: 'Cadência precisa estar em rascunho ou pausada para editar passos' };
  }

  // Passos atuais — base para preservar IDs e detectar mudança estrutural.
  const { data: existingRows, error: existingError } = (await from(supabase, 'cadence_steps')
    .select('id, step_order, auto_send')
    .eq('cadence_id', cadenceId)
    .order('step_order', { ascending: true })) as { data: ExistingStep[] | null; error: { message: string } | null };

  if (existingError) {
    return { success: false, error: 'Erro ao ler passos existentes' };
  }

  const existing = existingRows ?? [];
  const existingIds = new Set(existing.map((s) => s.id));
  const existingOrderById = new Map(existing.map((s) => [s.id, s.step_order]));
  const existingAutoSendById = new Map(existing.map((s) => [s.id, s.auto_send === true]));

  // Normaliza: ordena, renumera 1..n e resolve o ID de cada passo. ID que
  // pertence à cadência (e ainda não foi usado nesta lista) é preservado; o
  // resto vira passo novo com UUID gerado aqui — assim um único upsert cobre
  // atualizações e inserções.
  const seen = new Set<string>();
  const rows = [...steps]
    .sort((a, b) => a.step_order - b.step_order)
    .map((s, index) => {
      const keep = s.id != null && existingIds.has(s.id) && !seen.has(s.id);
      if (keep) seen.add(s.id as string);
      const wantsAutoSend = s.auto_send ?? (keep ? existingAutoSendById.get(s.id as string) === true : false);
      return {
        id: keep ? (s.id as string) : randomUUID(),
        cadence_id: cadenceId,
        step_order: index + 1,
        channel: s.channel,
        delay_days: s.delay_days,
        delay_hours: s.delay_hours ?? 0,
        template_id: s.template_id ?? null,
        ai_personalization: s.ai_personalization ?? false,
        activity_name: s.activity_name ?? null,
        instructions: s.instructions ?? null,
        call_provider: s.call_provider ?? null,
        // Envio automático só com template: o texto livre do passo pode ser instrução para o SDR.
        auto_send: s.channel === 'whatsapp' && !!s.template_id && wantsAutoSend,
      };
    });

  const keptRows = rows.filter((r) => seen.has(r.id));
  const removedIds = existing.filter((e) => !seen.has(e.id)).map((e) => e.id);
  const createdCount = rows.length - keptRows.length;
  const keptOrderBefore = existing.filter((e) => seen.has(e.id)).map((e) => e.id).join(',');
  const keptOrderAfter = keptRows.map((r) => r.id).join(',');
  const isStructural = createdCount > 0 || removedIds.length > 0 || keptOrderBefore !== keptOrderAfter;

  // Mudança estrutural com leads em andamento: `current_step` é posicional, então
  // inserir/remover/reordenar muda a atividade que cada lead "está" fazendo.
  // Só segue com confirmação explícita.
  if (isStructural) {
    const { count } = (await from(supabase, 'cadence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('cadence_id', cadenceId)
      .in('status', ['active', 'paused'])) as { count: number | null };

    const inProgress = count ?? 0;
    if (inProgress > 0 && !options.confirmActiveEnrollments) {
      return {
        success: false,
        code: ACTIVE_ENROLLMENTS_CODE,
        error:
          `Esta cadência tem ${inProgress} lead${inProgress === 1 ? '' : 's'} em andamento. ` +
          'Inserir, remover ou reordenar passos muda a posição desses leads na cadência. ' +
          'Os passos mantidos preservam o histórico; os removidos perdem o vínculo com as atividades já feitas.',
      };
    }
  }

  // 1) Apaga só o que saiu da timeline.
  if (removedIds.length > 0) {
    const { error: deleteError } = await from(supabase, 'cadence_steps')
      .delete()
      .in('id', removedIds);

    if (deleteError) {
      return { success: false, error: 'Erro ao remover passos' };
    }
  }

  // 2) Passos mantidos que mudaram de posição vão para uma ordem temporária
  //    (evita colisão do UNIQUE durante a renumeração).
  const orderChanged = keptRows.some((r) => existingOrderById.get(r.id) !== r.step_order);
  if (keptRows.length > 0 && orderChanged) {
    const { error: tempError } = await from(supabase, 'cadence_steps')
      .upsert(
        keptRows.map((r) => ({ ...r, step_order: r.step_order + TEMP_ORDER_OFFSET })) as Record<string, unknown>[],
        { onConflict: 'id' },
      );

    if (tempError) {
      return { success: false, error: 'Erro ao reordenar passos' };
    }
  }

  // 3) Grava tudo na ordem final: mantidos atualizados no lugar, novos inseridos.
  if (rows.length > 0) {
    const { error: upsertError } = await from(supabase, 'cadence_steps')
      .upsert(rows as Record<string, unknown>[], { onConflict: 'id' });

    if (upsertError) {
      return { success: false, error: 'Erro ao salvar passos' };
    }
  }

  // Update total_steps
  await from(supabase, 'cadences')
    .update({ total_steps: rows.length } as Record<string, unknown>)
    .eq('id', cadenceId);

  return {
    success: true,
    data: {
      saved: rows.length,
      preserved: keptRows.length,
      created: createdCount,
      removed: removedIds.length,
    },
  };
}
