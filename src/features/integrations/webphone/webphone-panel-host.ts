// Onde o painel flutuante do webphone é desenhado.
//
// O painel vive no layout `(app)`. Uma gaveta/modal do Radix (ex.: a gaveta de
// execução da fila de atividades, que cobre a tela inteira) fica por cima dele
// e, enquanto aberta, bloqueia cliques fora dela, prende o foco e se fecha ao
// clique externo — o painel some e não dá para digitar as anotações.
//
// Solução: a gaveta monta um "encaixe" (`WebphonePanelHost`) e o painel se
// desenha DENTRO dele via portal enquanto ele existir; fechou a gaveta, o
// painel volta ao layout. Pilha: o encaixe montado por último vence.

let hosts: HTMLElement[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Registra um encaixe. Devolve a função que o remove. */
export function registerWebphonePanelHost(el: HTMLElement): () => void {
  hosts = [...hosts.filter((h) => h !== el), el];
  emit();
  return () => {
    const next = hosts.filter((h) => h !== el);
    if (next.length === hosts.length) return;
    hosts = next;
    emit();
  };
}

/** Encaixe ativo (o último montado) ou `null` para desenhar no layout. */
export function getWebphonePanelHost(): HTMLElement | null {
  return hosts[hosts.length - 1] ?? null;
}

export function subscribeWebphonePanelHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
