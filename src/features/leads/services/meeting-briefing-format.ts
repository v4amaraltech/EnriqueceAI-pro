/**
 * Formatação do e-mail de briefing do closer (send-meeting-briefing.ts).
 * Fica fora do arquivo 'use server' porque lá só podem ser exportadas
 * funções async.
 */

export interface BriefingNote {
  text: string;
  created_at: string;
  author: string | null;
}

interface SdrUserLike {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Nome do pré-vendas para o e-mail. O cadastro guarda o nome em `full_name`
 * (convite/perfil); `name` é legado. Só cai no e-mail quando não há nome.
 */
export function resolveSdrDisplayName(user: SdrUserLike | null | undefined): string {
  const md = user?.user_metadata ?? {};
  return nonEmpty(md.full_name) ?? nonEmpty(md.name) ?? nonEmpty(user?.email) ?? 'Pré-vendas';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa o texto e transforma URLs http(s) em links clicáveis. */
function escapeAndLinkify(text: string): string {
  return escapeHtml(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" style="color:#E53935;">${url}</a>`,
  );
}

function formatNoteDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

/**
 * Conteúdo do bloco "Notas do pré-vendas": o campo antigo `leads.notes` e as
 * anotações da aba Anotações do lead (interactions com metadata.is_note), da
 * mais antiga para a mais nova. Retorna '' quando não há nada.
 */
export function buildBriefingNotesHtml(legacyNotes: string | null, notes: BriefingNote[]): string {
  const parts: string[] = [];

  const legacy = nonEmpty(legacyNotes);
  if (legacy) {
    parts.push(`<div style="white-space:pre-wrap;">${escapeAndLinkify(legacy)}</div>`);
  }

  for (const note of notes) {
    const text = nonEmpty(note.text);
    if (!text) continue;
    const meta = [formatNoteDate(note.created_at), note.author ? escapeHtml(note.author) : null]
      .filter(Boolean)
      .join(' — ');
    parts.push(
      `<div style="margin-top:${parts.length ? '14px' : '0'};">` +
        `<div style="color:#9ca3af;font-size:13px;margin-bottom:4px;">${meta}</div>` +
        `<div style="white-space:pre-wrap;">${escapeAndLinkify(text)}</div>` +
        `</div>`,
    );
  }

  return parts.join('');
}
