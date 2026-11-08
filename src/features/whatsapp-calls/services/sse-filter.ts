// Pista 16: filtro dos eventos SSE do serviço de voz por sessão do usuário.
// O upstream faz broadcast a todos os assinantes; aqui só passam eventos das
// sessões (service_session_id) do usuário logado.

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sessionIdOf(data: Json): string | null {
  for (const k of ['sessionId', 'sid', 'session_id']) {
    const v = data[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * Recebe um bloco SSE completo (sem a linha em branco final) e devolve o bloco
 * a repassar, ou null para descartar.
 * - comentários/keepalive (sem `data:`) passam;
 * - JSON inválido é descartado (fail-closed);
 * - snapshot `{ sessions: [...] }` é reduzido às sessões do usuário;
 * - evento com identificador de sessão só passa se for do usuário;
 * - eventos sem identificador de sessão (QR global e `call-*`, cujo id de chamada
 *   é gerado pelo serviço) passam, pois o upstream não os associa a uma sessão.
 */
export function filterSseBlock(block: string, allowedSids: ReadonlySet<string>): string | null {
  const lines = block.split('\n');
  const dataLines = lines.filter((l) => l.startsWith('data:'));
  if (dataLines.length === 0) return block;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.map((l) => l.slice(5).replace(/^ /, '')).join('\n'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const sid = sessionIdOf(parsed);
  if (sid !== null && !allowedSids.has(sid)) return null;

  if (Array.isArray(parsed.sessions)) {
    const mine = parsed.sessions.filter((s) => {
      if (!isRecord(s)) return false;
      const id = (typeof s.id === 'string' && s.id) || (typeof s.sid === 'string' && s.sid) || null;
      return id !== null && allowedSids.has(id);
    });
    const rewritten = JSON.stringify({ ...parsed, sessions: mine });
    return [...lines.filter((l) => !l.startsWith('data:')), `data: ${rewritten}`].join('\n');
  }
  return block;
}

/** Transform que reparte o stream em blocos SSE e aplica o filtro. */
export function createSseFilterStream(
  getAllowedSids: (opts: { refresh: boolean }) => Promise<ReadonlySet<string>>,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  async function emit(block: string, controller: TransformStreamDefaultController<Uint8Array>) {
    let allowed = await getAllowedSids({ refresh: false });
    let out = filterSseBlock(block, allowed);
    if (out === null) {
      // Sessão recém-criada (pareamento) ainda fora do cache: recarrega uma vez.
      allowed = await getAllowedSids({ refresh: true });
      out = filterSseBlock(block, allowed);
    }
    if (out !== null) controller.enqueue(encoder.encode(`${out}\n\n`));
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.trim()) await emit(block, controller);
      }
    },
  });
}
