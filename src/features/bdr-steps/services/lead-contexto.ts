/**
 * BDR — Histórico do lead em formato curto para a IA (ligações, e-mails, WhatsApp).
 * Regras puras; a rota /api/v1/bdr/leads/{id}/contexto faz o I/O.
 */

export interface InteracaoBruta {
  created_at: string;
  channel: string;
  type: string;
  message_content: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ItemHistorico {
  quando: string;
  canal: string;
  tipo: string;
  texto: string | null;
  resultado?: string | null;
  assunto?: string | null;
}

const MAX_TEXTO = 600;

function semHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function cortar(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = semHtml(s);
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}…` : t || null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Eventos internos (system, aberturas repetidas) não ajudam a IA a escrever: ficam só nas contagens. */
function relevante(i: InteracaoBruta): boolean {
  if (i.channel === 'system') return false;
  if (i.type === 'opened' || i.type === 'clicked') return false;
  return true;
}

export function resumirHistorico(cronologico: InteracaoBruta[]): {
  historico: ItemHistorico[];
  contagem: { ligacoes: number; ligacoes_atendidas: number; emails_enviados: number; emails_abertos: number; respostas: number; whatsapps_enviados: number };
} {
  const contagem = { ligacoes: 0, ligacoes_atendidas: 0, emails_enviados: 0, emails_abertos: 0, respostas: 0, whatsapps_enviados: 0 };
  const historico: ItemHistorico[] = [];

  for (const i of cronologico) {
    const meta = i.metadata ?? {};
    const resultado = meta.resultado && typeof meta.resultado === 'object' ? (meta.resultado as Record<string, unknown>) : {};

    if (i.channel === 'phone' && i.type !== 'failed') {
      contagem.ligacoes++;
      if (meta.evento === 'chamada_finalizada' && meta.motivo !== 'linha_muda') contagem.ligacoes_atendidas++;
    }
    if (i.channel === 'phone' && i.type === 'failed') contagem.ligacoes++;
    if (i.channel === 'email' && i.type === 'sent') contagem.emails_enviados++;
    // Só abertura/clique real (depois do corte, gravado no próprio envio): a do robô de segurança não conta.
    if (i.channel === 'email' && i.type === 'sent' && (texto(meta.aberto_real_em) || texto(meta.clicado_real_em))) contagem.emails_abertos++;
    if (i.channel === 'whatsapp' && i.type === 'sent') contagem.whatsapps_enviados++;
    if (i.type === 'replied') contagem.respostas++;

    if (!relevante(i)) continue;
    historico.push({
      quando: i.created_at,
      canal: i.channel,
      tipo: i.type,
      texto: cortar(i.message_content),
      resultado: i.channel === 'phone' ? texto(meta.evento) ?? texto(resultado.proxima_acao) : undefined,
      assunto: i.channel === 'email' ? texto(meta.subject) : undefined,
    });
  }
  return { historico, contagem };
}
