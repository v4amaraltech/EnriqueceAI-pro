// Registro dos AudioContext abertos pelo webphone (escuta dos 15 s e tap de
// diagnóstico). Módulo PURO, sem DOM.
//
// Esses contextos nascem no evento `track` da ligação, quase sempre fora de um
// clique, e o Chrome os deixa `suspended` (o áudio lido sai vazio). O
// `resume()` só vale com gesto do SDR, então a aba chama
// `resumeWebphoneAudioContexts()` no mesmo clique em que pede ou confirma o
// microfone. Fora de gesto o `resume()` pode rejeitar: o erro é engolido.

export interface ResumableAudioContext {
  readonly state?: string;
  resume(): Promise<void>;
}

const openContexts = new Set<ResumableAudioContext>();

function tryResume(ctx: ResumableAudioContext): void {
  if (ctx.state === 'running' || ctx.state === 'closed') return;
  try {
    void Promise.resolve(ctx.resume()).catch(() => undefined);
  } catch {
    /* sem gesto o navegador pode recusar; tenta de novo no próximo clique */
  }
}

/**
 * Registra um contexto recém-criado e já tenta o `resume()`. Devolve a função
 * que o retira do registro (chamar ao fechar o contexto).
 */
export function registerWebphoneAudioContext(ctx: ResumableAudioContext): () => void {
  openContexts.add(ctx);
  tryResume(ctx);
  return () => {
    openContexts.delete(ctx);
  };
}

/** `resume()` em todos os contextos abertos. Chamar dentro de um clique. Nunca lança. */
export function resumeWebphoneAudioContexts(): void {
  for (const ctx of openContexts) tryResume(ctx);
}

/** Quantos contextos estão registrados (testes). */
export function webphoneAudioContextCount(): number {
  return openContexts.size;
}

/** Limpa o registro (testes). */
export function resetWebphoneAudioContextsForTests(): void {
  openContexts.clear();
}
