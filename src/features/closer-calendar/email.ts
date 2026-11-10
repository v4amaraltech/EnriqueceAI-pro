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
    '<p>O time de pré-vendas precisa ver os horários livres da sua agenda para marcar reuniões.</p>',
    '<p>Abra o link abaixo e conecte sua conta Google. O link vale por 7 dias e só pode ser usado uma vez. Você não precisa criar uma conta na plataforma.</p>',
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    '<p>O Google pede permissão só para consultar os horários livres da agenda. Não pedimos acesso ao Gmail.</p>',
    '<p>Se você não esperava este e-mail, ignore.</p>',
    '<p>EnriqueceAI</p>',
  ].join('');
  return { subject: CLOSER_CALENDAR_COPY.emailSubject, html };
}
