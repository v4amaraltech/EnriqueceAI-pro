/**
 * Prazo do Cockpit para a sessão SIP desta aba aparecer depois de o POST de discagem ser aceito. PRÓPRIO do Cockpit: a
 * constante `LOCAL_SESSION_GRACE_MS` (2 s) é do Power Dialer e não deve mudar. A operadora às vezes leva mais de 2 s
 * (a perna da Nabila entrou 5 s depois do POST); aos 2 s o motor cancelava a reserva do token e pausava, e a ligação que
 * entrava depois ficava sem controle. Durante a espera a reserva do token NÃO é cancelada (um INVITE atrasado ainda é
 * reconhecido por `claimWebphoneDial`); só ao estourar o prazo ela é cancelada e o motor pausa.
 */
export const COCKPIT_SESSION_GRACE_MS = 15_000;

/**
 * Pausa por sessão que não entrou (só depois de COCKPIT_SESSION_GRACE_MS). Não diz "desligue" como certeza: a ligação pode
 * ainda aparecer no webphone, e nesse caso o SDR a conduz pelo painel do lead e a desliga no botão Desligar.
 */
export const COCKPIT_SESSION_MISSING_MESSAGE =
  'O pedido foi aceito, mas o webphone desta aba não entrou na ligação em 15 s. Se a ligação aparecer no webphone, conduza-a pelo painel do lead e desligue antes de iniciar de novo.';
