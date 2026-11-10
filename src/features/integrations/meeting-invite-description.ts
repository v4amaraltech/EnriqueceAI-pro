/**
 * Descrição padrão do convite de reunião marcado pelo pré-vendas.
 * Fonte única: não há campo por organização para este texto.
 * O SDR pode editar antes de confirmar. String vazia é escolha dele e não
 * volta para o padrão. Ausência (chamadas antigas) usa este texto.
 */
export const DEFAULT_MEETING_INVITE_DESCRIPTION = `✅ Para acessar a reunião basta clicar no link abaixo e depois no botão azul de "Entrar com Google Meet" ou se estiver em inglês "Login with Google Meet". Algumas informações sobre a nossa reunião:

💻 1) É fundamental acessar de um computador ou notebook com câmera, para visualizar melhor as informações;

🎥 2) Não é obrigatório, mas é melhor usar uma webcam;

🎧 3) Fundamental você ter microfone e de preferência um fone de ouvido, também;

📶 4) É importante ter uma boa conexão de 'internet'. Se possível, com cabo.`;

export function meetingInviteDescription(value: string | null | undefined): string {
  if (value === undefined || value === null) return DEFAULT_MEETING_INVITE_DESCRIPTION;
  return value;
}

/** Recupera a descrição gravada no histórico, sem o título, o Meet e o horário. */
export function descriptionFromMeetingRecord(messageContent: string | null | undefined): string | null {
  if (!messageContent) return null;
  const body = messageContent.split('\n').slice(1);
  const end = body.findIndex((line) => line.startsWith('Google Meet:') || line.startsWith('Horário:'));
  const chunk = (end === -1 ? body : body.slice(0, end)).join('\n').trim();
  return chunk || null;
}
