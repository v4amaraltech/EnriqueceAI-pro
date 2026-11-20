# Handoff: "Resultado da Ligação" aparecia duas vezes (20/11/2026)

Pedido do Vini: no **Cockpit → Tarefas do dia**, ao terminar uma ligação aparecia primeiro um modal "Resultado da Ligação" menor e, segundos depois, sem nenhum clique, um maior. Ele queria só um. O mesmo acontecia no discador.

## Causa
- **Não eram dois modais.** Era o mesmo `CallResultModal` do `ActivityPhonePanel`, mudando de forma com ele aberto.
- Na API4COM, só o webhook diz se o lead atendeu (`answered_at`). Até ele chegar, `leadAnswer` fica `unknown` e `leadAnsweredByServer` dá `false`.
- O modal abria logo no hangup, com `connected=false`. Aparecia a versão curta: "Não atendida 00:05 · Ninguém atendeu". Nessa hora o webphone ainda mostrava "Confirmando com a operadora…".
- Uns 3 a 6 s depois, o polling (`useWebphoneCallOutcome`, a cada 3 s) trazia `answered`. O modal então reaplicava o padrão e virava a versão completa: "Provável caixa postal" + "O que aconteceu?".
- O `useExclusiveCallResultOpen` (PRs #616 e #618) não tem relação com isso: ele evita dois donos abrindo o modal ao mesmo tempo. Aqui havia um dono só.

## Correção
Arquivo `src/features/activities/components/ActivityPhonePanel.tsx`:
- **`waitingOperator`:** vale quando o discador é API4COM, a ligação acabou (`ended`), há `callId` e `leadAnswer === 'unknown'`. Enquanto isso o modal fica fechado: `open={callState === 'ended' && !waitingOperator}`.
- **Teto `OPERATOR_CONFIRM_MAX_WAIT_MS = 15_000`:** se o webhook atrasar, o modal abre mesmo assim. Nesse caso raro ele ainda pode abrir na versão curta e crescer depois.
- No layout `dock`, o status mostra **"Confirmando com a operadora…"** em vez de "Encerrada" durante a espera.
- WhatsApp e outros discadores não mudam (`dialerProvider !== 'api4com'`).

## Entregue
- **PR #677:** https://github.com/v4amaraltech/EnriqueceAI-pro/pull/677
  - Ramo `fix/cockpit-resultado-espera-operadora`, criado a partir do `origin/main`.
  - O ramo antigo `feat/cockpit-motor-automatico-2` não foi usado porque o PR #646 dele já estava mesclado e ele estava atrás do main.
- **Commits:**
  - correção (cherry-pick do `b8c5d687`, que ficou também no ramo antigo, só local);
  - `test(cockpit)`: espera mais longa nos testes, para não falharem com a máquina cheia, + prettier.
- **Testes:**
  - Novo `ActivityPhonePanel.wait-operator.test.tsx`. Verifica que não abre enquanto a resposta é `unknown`, que abre direto na versão de atendida e que abre após o teto. Os 2 falham sem a correção.
  - `activities/components` + `cockpit`: 1079/1079 passando. Typecheck e lint ok.
- **Auto-fix do app ligado** no PR. O merge automático do GitHub não é permitido no repositório, então ficou um vigia em segundo plano: mescla com squash e apaga o ramo quando o CI ficar verde; não mescla se algo falhar.
- Sem migration.

## Pontos de atenção
- Depois de desligar, o SDR espera ~3–6 s com "Confirmando com a operadora…" antes do modal. É o mesmo tempo que antes ficava na versão curta.
- **Falha pré-existente, sem relação com esta mudança:** `src/features/activities/actions/fetch-dialer-queue.test.ts` ("com a flag ligada, sobe resposta, no-show e abertura…") falha também sem a mudança, no ramo `feat/cockpit-motor-automatico-2`. No `main` atual, os testes das pastas de componentes e do cockpit passaram; a pasta `actions` não foi rodada lá.
- `pnpm typecheck` local acusa erro em `src/app/docs/dev-preview-motor/page.tsx`: pasta local, fora do git, sem impacto no PR.

## Pendente
- Confirmar o merge do #677 e o deploy (`/api/version` = commit do squash).
- Testar numa ligação real no Cockpit: atendida, caixa postal e não atendida.
- Alterações locais antigas continuam sem commit: `AGENTS.md`, `supabase/.temp/cli-latest`, runbooks, handoffs de 06–07/11 e 3 migrations de 19/10.
- Este handoff não foi commitado.
