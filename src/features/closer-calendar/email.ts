import { CLOSER_CALENDAR_COPY } from './copy';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildCloserCalendarInviteEmail(input: { name: string; link: string }): { subject: string; html: string } {
  const name = input.name.trim() || 'olá';
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(input.link);
  const html = [
    `<p>Olá, ${safeName}.</p>`,
    '<p>O time de pré-vendas precisa ver a sua agenda para marcar reuniões. Ele verá os horários ocupados e o título dos seus compromissos, exceto os marcados como privados, que aparecem só como "Privado".</p>',
    '<p>Abra o link abaixo e conecte sua conta Google. O link vale por 7 dias e só pode ser usado uma vez. Você não precisa criar uma conta na plataforma.</p>',
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    '<p>O Google pede permissão só para consultar a agenda, sem alterar nada. Não pedimos acesso ao Gmail.</p>',
    '<p>Se você não esperava este e-mail, ignore.</p>',
    '<p>EnriqueceAI</p>',
  ].join('');
  return { subject: CLOSER_CALENDAR_COPY.emailSubject, html };
}
