import type { SupabaseClient } from '@supabase/supabase-js';

import { findMessageByRfcId } from '@/features/email-conversations/services/gmail-inbox.service';
import { EmailService, refreshAccessToken, type GmailConnection } from '@/features/integrations/services/email.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { WhatsAppService } from '@/features/integrations/services/whatsapp.service';
import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ProviderAdapter, ProviderAdapters, ProviderLookupOutcome, ProviderSendOutcome, ProviderSendRequest } from './dispatcher.service';

/**
 * Adaptadores de provedor do dispatcher (PR08).
 *
 * Camada fina por COMPOSICAO sobre os servicos existentes (`WhatsAppService`,
 * `EvolutionWhatsAppService`, `EmailService`), que nao sao alterados. Cada
 * adaptador so traduz o resultado do servico para o contrato do dispatcher:
 *
 *   accepted  o provedor aceitou e devolveu o id
 *   rejected  garantidamente NADA saiu (falha antes da chamada ou recusa definitiva)
 *   ambiguous qualquer outra coisa: pode ter saido, vira `uncertain`
 *
 * Na duvida, `ambiguous`. A lista de mensagens "nada saiu" e fechada e vem do
 * codigo atual dos servicos; texto novo ou desconhecido nunca vira `rejected`.
 *
 * Politica: um adaptador por provedor, sem fallback. O adaptador do Evolution
 * resolve a instancia a partir do `senderInstanceId` AUTORIZADO pelo gateway e
 * usa `sendFromUserInstance` (so a instancia do proprio usuario, nunca a padrao da
 * organizacao). Nenhum adaptador troca, cria ou rotaciona numero.
 */

type Db = SupabaseClient;

const ambiguous = (reason: string): ProviderSendOutcome => ({ kind: 'ambiguous', reason });
const rejected = (reason: string): ProviderSendOutcome => ({ kind: 'rejected', reason });

// Mensagens fixas dos servicos atuais emitidas ANTES de qualquer chamada de envio.
const META_NOT_SENT_EXACT = ['Nenhuma conexão WhatsApp ativa encontrada', 'Número de telefone inválido'];
const META_NOT_SENT_PREFIX = ['Rate limit excedido'];
const EVOLUTION_NOT_SENT_EXACT = [
  'Número de telefone inválido',
  'Esse número não está cadastrado no WhatsApp',
  'Evolution API não configurada no servidor',
];

// ---------------------------------------------------------------------------
// WhatsApp oficial (Cloud API)
// ---------------------------------------------------------------------------

export interface MetaCloudAdapterDeps {
  db?: () => Db;
  send?: typeof WhatsAppService.sendMessage;
}

export function createMetaCloudAdapter(deps: MetaCloudAdapterDeps = {}): ProviderAdapter {
  const db = deps.db ?? (() => createServiceRoleClient() as unknown as Db);
  const sendMessage = deps.send ?? ((...args: Parameters<typeof WhatsAppService.sendMessage>) => WhatsAppService.sendMessage(...args));
  return {
    provider: 'meta_cloud',
    async send(req: ProviderSendRequest): Promise<ProviderSendOutcome> {
      const { command, payload } = req;
      if (command.requiresTemplate && !command.templateId) return rejected('template_missing');
      try {
        const result = await sendMessage(
          req.orgId,
          {
            to: req.to,
            body: payload.body,
            ...(command.requiresTemplate && command.templateId
              ? { templateName: command.templateId, templateParams: payload.templateParams }
              : {}),
          },
          db(),
        );
        if (result.success) {
          return result.messageId ? { kind: 'accepted', externalId: result.messageId } : ambiguous('accepted_without_message_id');
        }
        const error = result.error ?? '';
        if (META_NOT_SENT_EXACT.includes(error) || META_NOT_SENT_PREFIX.some((p) => error.startsWith(p))) {
          return rejected('provider_not_sent');
        }
        // O servico nao expõe status HTTP: erro de API (4xx/5xx) nao e classificavel aqui.
        return ambiguous('provider_error_unclassified');
      } catch {
        return ambiguous('provider_exception');
      }
    },
    // A Cloud API nao oferece consulta por mensagem sem id; o resultado final chega por callback.
    async lookup(): Promise<ProviderLookupOutcome> {
      return { kind: 'unknown' };
    },
  };
}

// ---------------------------------------------------------------------------
// WhatsApp Evolution (continuidade autorizada)
// ---------------------------------------------------------------------------

export interface EvolutionAdapterDeps {
  db?: () => Db;
  sendFromUserInstance?: typeof EvolutionWhatsAppService.sendFromUserInstance;
}

export function createEvolutionAdapter(deps: EvolutionAdapterDeps = {}): ProviderAdapter {
  const db = deps.db ?? (() => createServiceRoleClient() as unknown as Db);
  const sendFromUserInstance =
    deps.sendFromUserInstance ??
    ((...args: Parameters<typeof EvolutionWhatsAppService.sendFromUserInstance>) =>
      EvolutionWhatsAppService.sendFromUserInstance(...args));
  return {
    provider: 'evolution',
    async send(req: ProviderSendRequest): Promise<ProviderSendOutcome> {
      const instanceId = req.command.senderInstanceId;
      if (!instanceId) return rejected('instance_missing');
      try {
        // A instancia vem do comando autorizado, nunca de uma escolha do adaptador.
        const { data } = (await from(db(), 'whatsapp_instances' as never)
          .select('id, user_id')
          .eq('org_id', req.orgId)
          .eq('id', instanceId)
          .limit(1)) as { data: Array<{ id: string; user_id: string | null }> | null };
        const instance = data?.[0];
        if (!instance) return rejected('instance_not_found');
        // Instancia padrao da organizacao (sem usuario) nao e usada: evita concentrar volume.
        if (!instance.user_id) return rejected('instance_without_user');

        const result = await sendFromUserInstance(db(), {
          orgId: req.orgId,
          userId: instance.user_id,
          to: req.to,
          body: req.payload.body,
        });
        if (result.success) {
          return result.messageId ? { kind: 'accepted', externalId: result.messageId } : ambiguous('accepted_without_message_id');
        }
        if (result.code) return rejected(`evolution_${result.code}`);
        if (result.error && EVOLUTION_NOT_SENT_EXACT.includes(result.error)) return rejected('provider_not_sent');
        return ambiguous('provider_error_unclassified');
      } catch {
        return ambiguous('provider_exception');
      }
    },
    // Sem endpoint de consulta usado pelo app: nunca resolve sozinho.
    async lookup(): Promise<ProviderLookupOutcome> {
      return { kind: 'unknown' };
    },
  };
}

// ---------------------------------------------------------------------------
// E-mail (Gmail)
// ---------------------------------------------------------------------------

/** Message-ID deterministico por entrada: permite consultar o Gmail depois de um timeout. */
export function rfcMessageIdForOutbox(outboxId: string): string {
  return `<outbox.${outboxId}@enriqueceai.com.br>`;
}

export interface EmailAdapterDeps {
  db?: () => Db;
  sendEmail?: typeof EmailService.sendEmail;
  /** Token valido da caixa do usuario, ou null se indisponivel. */
  getAccessToken?: (db: Db, orgId: string, userId: string) => Promise<string | null>;
  findByRfcId?: (token: string, rfcMessageId: string) => Promise<string | null>;
}

async function defaultGetAccessToken(db: Db, orgId: string, userId: string): Promise<string | null> {
  const { data } = (await from(db, 'gmail_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('status', ['connected', 'error'])
    .single()) as { data: GmailConnection | null };
  if (!data) return null;
  if (data.status === 'error' || new Date(data.token_expires_at) < new Date()) {
    const refreshed = await refreshAccessToken(data, db);
    return 'accessToken' in refreshed ? refreshed.accessToken : null;
  }
  return decrypt(data.access_token_encrypted);
}

export function createEmailAdapter(deps: EmailAdapterDeps = {}): ProviderAdapter {
  const db = deps.db ?? (() => createServiceRoleClient() as unknown as Db);
  const sendEmail = deps.sendEmail ?? ((...args: Parameters<typeof EmailService.sendEmail>) => EmailService.sendEmail(...args));
  const getAccessToken = deps.getAccessToken ?? defaultGetAccessToken;
  const findByRfcId = deps.findByRfcId ?? findMessageByRfcId;
  return {
    provider: 'gmail',
    async send(req: ProviderSendRequest): Promise<ProviderSendOutcome> {
      const { payload } = req;
      if (!payload.senderUserId) return rejected('sender_user_missing');
      if (!payload.subject) return rejected('subject_missing');
      try {
        const result = await sendEmail(
          payload.senderUserId,
          req.orgId,
          {
            to: req.to,
            subject: payload.subject,
            htmlBody: payload.body,
            leadId: req.leadId,
            messageId: rfcMessageIdForOutbox(req.outboxId),
          },
          undefined,
          db(),
        );
        if (result.success) {
          return result.messageId ? { kind: 'accepted', externalId: result.messageId } : ambiguous('accepted_without_message_id');
        }
        // Sem `stage`: falhou antes do POST de envio (sem conexao, token). Nada saiu.
        if (!result.stage && result.httpStatus == null) return rejected('email_not_sent_before_request');
        // Gmail respondeu 4xx (exceto 408): recusa definitiva.
        if (result.stage === 'response' && result.httpStatus != null && result.httpStatus >= 400 && result.httpStatus < 500 && result.httpStatus !== 408) {
          return rejected(`gmail_http_${result.httpStatus}`);
        }
        return ambiguous(`gmail_http_${result.httpStatus ?? 'unknown'}`);
      } catch {
        // O fetch do envio lanca em falha de rede: pode ter saido.
        return ambiguous('provider_exception');
      }
    },
    async lookup(req: ProviderSendRequest): Promise<ProviderLookupOutcome> {
      const userId = req.payload.senderUserId;
      if (!userId) return { kind: 'unknown' };
      try {
        const token = await getAccessToken(db(), req.orgId, userId);
        if (!token) return { kind: 'unknown' };
        const found = await findByRfcId(token, rfcMessageIdForOutbox(req.outboxId));
        return found ? { kind: 'accepted', externalId: found } : { kind: 'not_accepted' };
      } catch {
        return { kind: 'unknown' };
      }
    },
  };
}

/** Conjunto padrao: um adaptador por provedor, sem fallback entre eles. */
export function createDefaultAdapters(): ProviderAdapters {
  return {
    meta_cloud: createMetaCloudAdapter(),
    evolution: createEvolutionAdapter(),
    gmail: createEmailAdapter(),
  };
}
