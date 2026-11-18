# Story: Painel de saúde do e-mail — motor, caixas, bounce e Gmail desconectado

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-11-18 | @dev (Dex) | Implementado. Conferido com o serviço real contra o banco (V4 Amaral, 01–18/nov): enviados, leads e bounce por caixa batem exatamente com SQL independente (ex.: 177/87/6, 163/130/16). Tela vista localmente (página temporária, já apagada); não vista logado em produção. Ready → InReview. |
| 2026-11-18 | @po (Pax) | Validação: GO 9/10. Ajustes aplicados: filtros da barra lateral (AC1), "vencido" com folga de 30 min e só no horário de envio (AC2), os dois avisos no `health-check-workers` com cooldown pela tabela `notifications` (AC8–9, sem migration), dono da caixa = `gmail_connections.user_id` casado com `metadata.sender_user_id` (99% dos envios de out–nov têm o campo). Draft → Ready. |
| 2026-11-18 | Vini + Claude | Story criada a partir da auditoria do motor de e-mail (18/nov). Depende da regra de "e-mail de prospecção" do PR #660 (`email-scope.ts`). |

## Origem

Auditoria de 18/nov (org V4 Amaral, 01/out–17/nov):

- **Não dá para ver o motor.** Saber se o e-mail automático está saindo, falhando ou dando bounce exigiu consultas direto no banco. A tela Estatísticas › E-mails mostra resultado de campanha, não a saúde do envio.
- **O bounce é alto e ninguém é avisado.** 87 de 732 leads (11,9%) deram bounce nos e-mails automáticos. Só a caixa do BDR IA tem trava de bounce (`checkBdrMailboxHealth`: pausa a caixa acima de 5% nos últimos 100 envios). As 7 caixas dos SDRs não têm limite diário (`daily_cap` nulo) nem trava de bounce, e 7 das 8 são do domínio principal `v4company.com`.
- **Gmail desconectado vira pausa silenciosa de lead.** Quando o token morre (`invalid_grant`), a conexão vai para `status='error'` e cada passo de e-mail falha como erro permanente ("reconexão necessária"). Cada inscrição é pausada uma a uma, com aviso por lead. Não existe aviso de "a caixa X caiu", e o gestor não fica sabendo. Foram 33 falhas desse tipo desde agosto.
- **Falhas espalhadas.** 25 envios falharam por lead sem e-mail e 33 por token. Não há lugar que some isso.
- Os robôs `execute-cadence-steps` e `check-email-replies` já gravam a última execução em `worker_run_state`, e o health-check avisa quando param (story `worker-health-alerts`). Isso cobre "parou", não cobre "está rodando mas falhando ou dando bounce".

## Alinhamento
Não há epic nem PRD para o motor de e-mail. A origem é a auditoria de 18/nov, a mesma do PR #660 (story `email-stats-medicao`). Esta story é o passo 2 do plano que saiu dela: 1) corrigir a medição, 2) dar visibilidade ao motor, 3) decidir validação, domínio secundário e Apollo.

## Story

**As a** gestor,
**I want** uma tela que mostre, por caixa e por dia, se o e-mail automático está saindo, falhando ou dando bounce, e ser avisado quando uma caixa cair,
**so that** eu descubra problema no envio em horas, não semanas, e sem precisar olhar o banco.

## Acceptance Criteria

### Tela
1. Nova aba **Estatísticas › Prospecção › Saúde do e-mail**, só para `manager` (o layout de Prospecção já exige `requireManager`). Usa os filtros da barra lateral: **período** e **SDR** (filtra as caixas pelo dono). O filtro de cadência vale para tabela, tendência e falhas. O bloco "Motor agora" ignora os filtros. Segue as mesmas regras de "e-mail de prospecção" da tela E-mails (`email-scope.ts`: cadência, saiu pelo Gmail, sem envio manual, lembrete, feedback do closer, Ana IA ou BDR).
2. **Bloco "Motor agora"**:
   - Última execução com sucesso do envio (`execute-cadence-steps`) e da checagem de respostas (`check-email-replies`), com aviso vermelho se o robô estiver parado, pela mesma regra do health-check.
   - E-mails enviados hoje e falhas hoje.
   - **Passos automáticos de e-mail vencidos e não enviados**: inscrições `active` cujo passo atual é e-mail com `auto_send` e `next_step_due` há **mais de 30 minutos** (o envio roda a cada 15 min). Mostra o número e há quanto tempo está vencido o mais antigo. Só fica vermelho dentro do horário de envio (seg–sex 08–18 BRT); fora dele aparece como "aguardando o próximo horário".
3. **Tabela por caixa** (uma linha por `gmail_connections` da org), com estas colunas:
   - e-mail da caixa e dono;
   - status: Conectada / **Precisa reconectar** (`status='error'`) / **Pausada** (`paused_reason`, com o motivo);
   - envios hoje ÷ limite diário (ou "sem limite");
   - envios no período;
   - leads com bounce e taxa (leads com bounce ÷ leads que receberam e-mail da caixa);
   - leads que responderam;
   - falhas no período;
   - último envio.
4. A caixa do envio é a `gmail_connections` cujo `user_id` = `metadata.sender_user_id` do `sent` (99% dos envios de out–nov têm o campo). Para linhas sem esse campo, usa `performed_by`, como já faz `mailboxCandidates`. Envio sem caixa identificada aparece numa linha "Caixa não identificada". Bounces e respostas entram na caixa do envio do mesmo lead e cadência.
5. **Cores da taxa de bounce**: até 3% normal; acima de 3% amarelo; acima de 5% vermelho, o mesmo limite da trava do BDR. Só colore com pelo menos 30 leads no período; abaixo disso mostra "amostra pequena".
6. **Tendência diária** (últimos 14 dias úteis): enviados, falhas, leads com bounce e leads que responderam, por dia, somando todas as caixas.
7. **Falhas por motivo** no período, agrupadas pelo `metadata.error` / `reason` dos `failed` de e-mail, por exemplo "Gmail precisa reconectar" e "lead sem e-mail", com contagem.

### Aviso
8. O `health-check-workers` (roda a cada 2h) procura conexões Gmail com `status='error'`. Para cada uma, notifica **o dono da caixa e os gestores da org**: "O Gmail de {email} desconectou — os e-mails automáticos dessa caixa estão parados. Reconecte em Configurações › Integrações." O aviso se repete **no máximo 1 vez a cada 24h por caixa** enquanto ela continuar em erro. O controle de repetição usa a tabela `notifications` com `resource_id` = id da conexão, como o `hasRecentAlert` que já existe. Sem migration.
9. No mesmo health-check: caixa com bounce acima de 5% (pelo menos 30 leads que receberam e-mail nos últimos 7 dias) notifica os gestores, **no máximo 1 vez a cada 24h por caixa**, com o mesmo controle. Só avisa: não pausa a caixa.

## Scope

**IN:**
- `src/app/(app)/statistics/prospecting/email-health/` (página nova) e a aba no layout de Prospecção.
- Serviço novo em `src/features/statistics/services/` reaproveitando `email-scope.ts` e `readAllRows`, mais componentes da tela.
- Avisos de Gmail desconectado e de bounce alto dentro de `src/app/api/cron/health-check-workers/route.ts`, reaproveitando `hasRecentAlert` e `createNotificationsForOrgMembers`.
- Testes da regra de cores, do agrupamento por caixa e do controle de repetição dos avisos.

**OUT:**
- Pausar caixa de SDR por bounce ou criar `daily_cap` para SDR (decisão de produto à parte).
- Mudar o comportamento de pausar a inscrição quando o Gmail desconecta: avaliar em story própria se o certo é **esperar** a reconexão em vez de pausar.
- Validação de e-mail antes do envio, domínio secundário e integração com o Apollo.
- Apagar as linhas duplicadas de `replied` no banco.
- WhatsApp e ligação.

## Dependencies
- PR #660 (`email-scope.ts`, regra de e-mail de prospecção) mesclado.
- Story `worker-health-alerts` (já no ar): `worker_run_state` e a regra de robô parado.

## Complexity
M (5 pontos): uma tela nova com 4 blocos, um serviço e dois avisos no health-check existente. Sem migration.

## Business Value
O motor de e-mail passou meses com falhas que só apareceram em auditoria: respostas não detectadas, bounce sem medição, Gmail caído pausando leads. Com o painel, o gestor vê o problema no mesmo dia e decide com número confiável (por exemplo, Apollo × motor próprio, ou se precisa de domínio secundário).

## Risks
- **Consulta pesada:** são muitas interações por caixa. Ler paginado (`readAllRows`) e só no período; se ficar lento, criar uma RPC agregada.
- **Excesso de aviso:** sem o controle de repetição, uma caixa caída notificaria a cada execução do robô (já aconteceu com bounce: 12 avisos por hora).
- **Caixa errada em envios antigos:** linhas sem `sender_user_id` podem cair na caixa errada; por isso existe a linha "Caixa não identificada".

## Definition of Done
- [x] AC 1–9 atendidos
- [x] `pnpm typecheck`, `pnpm lint` e testes da feature passando (+ `pnpm build`)
- [x] Números da tela conferidos contra o banco num período real (01–18/nov)
- [ ] Tela conferida logado como gestor (e bloqueada para SDR)

## Tasks
- [x] Serviço de saúde por caixa e por dia (reaproveitando `email-scope.ts`)
- [x] Bloco "Motor agora" (`worker_run_state` + passos vencidos)
- [x] Tela e aba nova em Prospecção
- [x] Aviso de Gmail desconectado no health-check (cooldown 24h por caixa)
- [x] Aviso de bounce alto por caixa no health-check (cooldown 24h por caixa)
- [x] Testes
- [x] Conferência no banco e na tela (local); falta ver logado em produção

## File List
- `docs/stories/email-engine-health-panel.story.md`
- `src/app/(app)/statistics/prospecting/email-health/page.tsx` (novo)
- `src/features/statistics/actions/fetch-email-health.ts` (novo)
- `src/features/statistics/components/EmailHealthView.tsx` (novo)
- `src/features/statistics/components/ProspectingSidebarNav.tsx`
- `src/features/statistics/services/email-health.logic.ts` (novo) + `.test.ts`
- `src/features/statistics/services/email-health.service.ts` (novo)
- `src/features/statistics/services/email-health-alerts.ts` (novo) + `.test.ts`
- `src/features/statistics/types/email-health.types.ts` (novo)
- `src/app/api/cron/health-check-workers/route.ts` + testes (mock dos avisos de caixa)

## Dev Notes
- `gmail_connections` (RLS: só o dono lê) e `worker_run_state` (sem acesso para `authenticated`) são lidos com service role **depois** de `getManagerOrgId()`, só colunas sem segredo e filtrados pela org.
- Cadência automática = `cadences.type = 'auto_email'` ou passo com `auto_send`; o cron do motor roda a cada 5 min (`*/5 11-20 * * 1-5` UTC), daí a folga de 30 min.
- Avisos usam `resource_type = 'mailbox'` (sem rota no sino, de propósito) e `resource_id = <conexão>:disconnected|bounce` para o controle de 24h.
- Na conferência (18/nov) a caixa do Vini estava em `status='error'` e 3 caixas acima de 5% de bounce (6,9%, 12,3%, 13,5%): os avisos vão disparar logo após o deploy.

## Validação @po (2026-11-18)

| # | Critério | Resultado |
|---|----------|-----------|
| 1 | Título claro | ✅ |
| 2 | Descrição do problema | ✅ com números da auditoria |
| 3 | AC testáveis | ✅ após ajustes (vencido com folga de 30 min, cooldown definido, filtros definidos) |
| 4 | Escopo IN/OUT | ✅ |
| 5 | Dependências | ✅ PR #660 e `worker-health-alerts` |
| 6 | Complexidade | ✅ M / 5 pontos |
| 7 | Valor de negócio | ✅ |
| 8 | Riscos | ✅ |
| 9 | Definição de pronto | ✅ |
| 10 | Alinhamento PRD/Epic | ⚠️ sem epic; ligada à auditoria e à story `email-stats-medicao` |

**Veredito: GO (9/10).** Status Draft → Ready.

Observação para @dev: só começar depois do PR #660 mesclado, porque a story reaproveita `email-scope.ts`.
