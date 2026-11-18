/**
 * Prazo do Cockpit para o resultado da operadora (webhook da API4COM) chegar depois que a ligação acabou no navegador.
 * PRÓPRIO do Cockpit: `AUTO_DIAL_ANSWER_TIMEOUT_MS` (20 s, do Power Dialer) não muda. O webhook chegou até ~24 s depois do
 * fim da ligação (caso Kauana/EUROGERM, 12:57–12:59 BRT) e 7–9 s nos outros; aos 20 s o motor mostrava "O lead conversou"
 * para uma ligação que não foi atendida. Com 45 s o atraso conhecido cabe com folga. Vale só para o ramo "sem resposta"
 * (`unknown`); o laço/fail-open da ligação atendida continua com o prazo de activities.
 */
export const COCKPIT_ANSWER_TIMEOUT_MS = 45_000;
