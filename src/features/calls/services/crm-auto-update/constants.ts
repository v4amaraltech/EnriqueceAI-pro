/**
 * Atualização automática do CRM a partir da qualificação da ligação (JEV).
 *
 * Modos, lidos de public.app_flags (as duas linhas nascem desligadas e com listas vazias):
 *  - off:    nada roda, nada é gravado.
 *  - shadow: org em allow_org_ids de CRM_AUTO_UPDATE_FLAG_KEY (ou flag global ligada).
 *            Calcula o que mudaria e grava só em crm_auto_update_shadow_log.
 *  - live:   exige shadow ligado E a org listada EXPLICITAMENTE em allow_org_ids de
 *            CRM_AUTO_UPDATE_LIVE_FLAG_KEY. `enabled = true` global na flag live não liga
 *            nenhuma org. Nesta versão o live escreve no CRM SÓ o desfecho de caixa postal
 *            (outcome JEV 'voicemail') com confiança >= CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE.
 *            O resto segue só no log, como no shadow (ver shouldApplyLiveVoicemail e o service).
 */
export const CRM_AUTO_UPDATE_FLAG_KEY = 'crm_auto_update_v1';
export const CRM_AUTO_UPDATE_LIVE_FLAG_KEY = 'crm_auto_update_v1_live';

/** Provedor da qualificação usada como fonte. */
export const CRM_AUTO_UPDATE_QUALIFICATION_PROVIDER = 'jev';

/**
 * Confiança mínima (call_qualifications.confidence) para aplicar sem humano.
 * Mais alta que o corte de needs_review do JEV (0,6): na faixa 0,6 a 0,75 a
 * ligação não vai para revisão, mas também não muda o CRM sozinha.
 */
export const CRM_AUTO_UPDATE_MIN_CONFIDENCE = 0.75;

/**
 * Corte da ESCRITA live (caixa postal). Não muda o would_apply do log (0,75):
 * entre 0,75 e 0,85 a caixa postal continua só proposta, mesmo em live. 0,85 inclusive.
 */
export const CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE = 0.85;

/** Desfecho JEV (string exata) que o live escreve. not_connected NÃO entra, mesmo mapeando para voicemail. */
export const CRM_AUTO_UPDATE_LIVE_OUTCOME = 'voicemail';

/** Origem gravada no marcador calls.metadata.crm_auto_update. */
export const CRM_AUTO_UPDATE_LIVE_SOURCE = 'crm_auto_update_v1_live';

/** Versão da regra de decisão gravada no log, para comparar regras diferentes no tempo. */
export const CRM_AUTO_UPDATE_RULES_VERSION = 'v1.1';
