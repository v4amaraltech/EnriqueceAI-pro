# Handoff: a extensão da API4COM atende no lugar do webphone (Power Dialer) (26/11/2026)

## Problema relatado
O Guilherme Marques relatou "interferência" no Power Dialer na hora de ligar, com a extensão da API4COM ligada no Chrome ao mesmo tempo que o webphone do EnriqueceAI.

## Causa
- A API4COM/Kazoo aceita mais de um registro SIP para o mesmo ramal. Com a extensão ativa, o ramal fica registrado duas vezes: na página (JsSIP, `wss://…:6443`) e na extensão.
- O `POST /calls` manda o INVITE (`X-Api4comintegratedcall: true`) para os dois registros. Quem atende primeiro fica com o áudio, e o outro recebe CANCEL.
- Quando a extensão ganhava, a página recebia o CANCEL e o Power Dialer/Cockpit tratavam aquilo como ligação encerrada. Seguiam para o próximo lead enquanto o SDR ainda falava pela extensão.
- Como foi confirmado: a configuração do Guilherme está certa. Ligações do app (`metadata.callRef`) **sem** `metadata.audio_stats` são as que a página não atendeu. O Ismael (ramal 1024) tem o mesmo padrão.

## O que está no ar
| PR | O que faz | Commit |
|----|-----------|--------|
| #688 | Aviso "a extensão da API4COM atendeu no lugar" e pausa da discagem automática | `82106f9` (squash) |

- `isAnsweredElsewhere()` em `webphone-state.ts`. O sinal é certo quando chega um CANCEL depois de a página ter respondido 200 OK (`answerSentCallId` no `webphone-client.ts`). Sem o 200 OK, vale o header `Reason` com "elsewhere" ou `cause=200`.
- Novo conflito de sessão `extension_answered`, no mesmo mecanismo de `other_tab`/`lost_to_other`. Ele bloqueia `dialingBlockReason`, o que faz o Power Dialer pausar (motivo `blocked`) e o auto-dial do Cockpit (`use-cockpit-auto-dial.ts`) parar.
- Na tela aparecem um toast de 15 s com a orientação e a pílula "Extensão da API4COM atendeu no lugar", com o botão **Já desativei** (`acknowledgeExtensionConflict()`). Um novo registro SIP não limpa o aviso, mas recarregar a página limpa.
- Testes: `webphone-state.test.ts` e `webphone-client.test.ts`. CI verde. Deploy confirmado em `/api/version`.

## Comunicação
- E-mail enviado do Gmail do Vini para o Guilherme e para o Ismael. O texto explica a causa, pede para desativar a extensão em `chrome://extensions` (fechar a janelinha não basta) e recarregar com uma aba só, e mostra como usar o botão "Já desativei".

## Pendências e limites conhecidos
- **Não foi testado com uma ligação real** com a extensão ativa. É preciso confirmar que o aviso aparece e que o Power Dialer pausa. A primeira vez que o Guilherme ou o Ismael passarem por isso já serve de teste.
- Limite: se a extensão atender **antes** de a página responder 200 OK, só o header `Reason` detecta o caso. Se a API4COM não mandar esse header, passa sem aviso. Isso deve ser raro, porque a página atende o INVITE integrado sozinha.
- Não existe hoje uma consulta pronta para acompanhar o caso. Para medir se continua acontecendo, use ligações do app sem `metadata.audio_stats`, agrupadas por SDR.

## Fora de escopo e intactos
- Worktree `EnriqueceAI_Pro-ext-conflict` (branch `fix/webphone-extension-conflict-warning`, já mesclado) mantido.
- A cópia principal do repo está na branch `feat/marcar-por-cima-closer-ocupado`, com mudanças locais. Ela não foi tocada, e este handoff não foi commitado.
