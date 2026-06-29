// Ligação via WhatsApp — gravação SEMPRE ON (decisão de produto #2). O lead é
// informado no início da chamada via este aviso.
//
// ⚠️ Jurídico (GO-condicional do @po): o texto exato do consentimento e a
// POLÍTICA DE RETENÇÃO do áudio precisam de validação legal (LGPD). Mantidos
// aqui como ponto único de verdade para facilitar o ajuste pós-jurídico.
export const RECORDING_CONSENT_NOTICE =
  'Esta ligação é gravada. Informe o lead de que a chamada está sendo gravada.';

// TODO(jurídico): definir base legal (LGPD) e período de retenção do áudio
// (hoje as gravações vivem no bucket privado `call-recordings` sem expurgo).
export const RECORDING_RETENTION_NOTE = 'Retenção de áudio: a definir com o jurídico.';

// Anti-ban / observabilidade (story 7.9). Janela móvel de 24h por número.
// Valores de partida do MVP — calibrar empiricamente conforme a tolerância da Meta.
export const DAILY_CALL_LIMIT = 50; // teto de ligações WhatsApp por número / 24h
export const HEALTH_MIN_SAMPLE = 5; // mínimo de chamadas p/ avaliar a taxa de falha
export const NOT_CONNECTED_ALERT_RATE = 0.5; // ≥50% not_connected = degradado (proxy de throttle/ban)
