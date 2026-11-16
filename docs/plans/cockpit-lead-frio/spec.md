# Spec: ordem do lead frio no Cockpit

Autor: @pm (Morgan) | Data: 15/11/2026 | Status: Rascunho para validação do usuário
Fontes: handoff `.aios/handoffs/handoff-analyst-to-pm-20261115-cockpit-lead-frio.yaml` (HO), `docs/plans/plano-crm-autonomo.md` (PLANO), `src/features/cockpit/services/next-call-card.service.ts` (NCC), `src/features/cockpit/utils/next-lead.ts` (NL), `src/features/contact-engine/services/call-priority.ts` (CP).
Regra: toda afirmação abaixo aponta para uma fonte. O que não tem fonte está em "Decisões pendentes".

## 1. Objetivo

O SDR liga em volume (meta 400 ligações/dia, enunciado do pedido). Hoje, no cartão "Próxima ligação" do Cockpit, o lead sem nenhum sinal (pontuação 0) é escolhido por `updated_at` (quem foi editado por último) (CP: `rankLeadsByPriority`; NL: `pickNextLead`) e o Cockpit só olha os 15 leads mais recentemente atualizados (NCC: `CANDIDATES_LIMIT = 15`, `.order('updated_at')`). Como ~96% dos leads da V4 não têm sinal (HO: `dados_v4_15_11`), a ordem real do Cockpit hoje é "o último que alguém mexeu".

Objetivo: quando não houver lead com sinal, o Cockpit mostra o lead frio na ordem decidida pelo usuário (opção 3, HO `decisions`):
1. cadência mais vencida (`next_step_due`);
2. menos tentativas recentes;
3. mais tempo desde a última ligação;
4. `updated_at` só como último desempate.

## 2. Escopo

Dentro:
- Cartão "Próxima ligação" do Cockpit: `next-call-card.service.ts` e `contact-engine/services/call-priority.ts` (HO `escopo.dentro`).
- Ordenar a carteira inteira do SDR, não só 15 leads (HO `decisions[2]`).
- Tudo atrás da flag `call_priority_v2`, só V4 via `allow_org_ids` (HO `escopo.flag`; PLANO "Regras gerais").

Fora:
- Menu "Execução" / Power Dialer (`src/features/activities/**`), `rank-dialer-queue.ts`, `fetch-dialer-queue.ts` (HO `escopo.fora`; pedido).
- Mudar a ordem de quem TEM sinal (resposta 7d, no-show 14d, abertura/clique 7d) (PLANO "Como funciona a prioridade").
- Mudar cadência, envio, política comercial (CP: comentário "Nada aqui altera política comercial").
- Ligar de verdade, mexer em flag/produção/banco (PLANO "Regras gerais").
- Cockpit e Execução seguem com ordens separadas (HO `decisions[3]`).

## 3. Requisitos funcionais

**FR-1 Lead frio = pontuação 0.** Lead frio é o que o score v2 devolve com `score = 0` (sem interesse e sem esforço) (CP: `computeCallPriority`).
- Given um lead sem sinais, When o Cockpit calcula a prioridade, Then ele é classificado como frio.
- Given um lead com qualquer sinal (score > 0), Then NÃO é frio e segue a ordem atual.

**FR-2 Quente sempre antes do frio.** Se existir qualquer lead com score > 0 na carteira, ele é mostrado antes de qualquer frio (CP: `rankLeadsByPriority`, ordem por score desc).
- Given 1 lead com resposta e 100 frios, When pede a próxima ligação, Then vem o lead com resposta.

**FR-3 Ordem do frio.** Entre frios, ordenar por: (1) `next_step_due` mais antigo primeiro; (2) menos tentativas recentes; (3) última ligação mais antiga (maior tempo desde a última ligação); (4) `updated_at` mais recente; (5) `lead_id` crescente para resultado estável (CP: já usa `leadId asc` como último desempate; o item 5 mantém esse comportamento) (HO `decisions[1]`).
- Given dois frios com `next_step_due` diferentes, Then vem o mais vencido.
- Given `next_step_due` igual, Then vem o de menos tentativas recentes; persistindo empate, o de ligação mais antiga; persistindo, o `updated_at` mais recente.
- Given os mesmos dados, When roda duas vezes, Then a ordem é idêntica (determinística).
- Definição de "tentativas recentes" e de "sem cadência vencida" no desempate: ver DP-1 e DP-3.

**FR-4 Carteira inteira.** A escolha do frio considera todos os leads elegíveis do SDR (hoje 239 a 533 por SDR, HO `leads_com_telefone_por_sdr`), não apenas os 15 mais recentes (NCC: `CANDIDATES_LIMIT`; HO `decisions[2]`). A ordenação ocorre no banco (HO `next_action`: consulta única que ordena a carteira).
- Given um SDR com 500 leads com telefone, When pede a próxima ligação, Then o lead escolhido é o primeiro da ordem de FR-3 sobre os 500, mesmo que não esteja entre os 15 mais recentes.

**FR-5 Filtros atuais preservados.** Continuam valendo: mesma org, não excluído, status fora de `unqualified/archived`, com telefone, assigned_to ou closer_id = SDR, fora de `contact_holds` tipo `total`, fora dos leads já trabalhados na sessão (`excludeLeadIds`) (NCC linhas 49-66, 93-96).
- Given lead em `contact_holds` total, When ele seria o primeiro frio, Then é pulado.
- Given falha ao ler bloqueios, Then retorna erro e não sugere lead (NCC: "não arriscar ligar").

**FR-6 Flag e rollback.** A nova ordem do frio só vale com `call_priority_v2` ligada para a org (CP: `CALL_PRIORITY_FLAG_KEY`; NCC: `isCallPriorityV2Enabled`). Com a flag desligada, vale exatamente a escolha atual (v1) (NCC comentário PR11).
- Given flag desligada, Then resultado idêntico ao de hoje.
- Given qualquer falha de leitura na nova rota, Then volta à escolha anterior (NCC: `rankWithPriorityV2` devolve `null`).

**FR-7 Rótulo na tela.** O cartão deve indicar que o lead é frio (sem sinal), para o SDR não achar que é um lead quente (HO `perguntas_para_o_pm[3]`: "etiqueta clara"; usuário escolheu mostrar frio ordenado). O texto exato está em DP-4.
- Given o lead mostrado é frio, Then o cartão exibe o rótulo definido; Given é quente, Then não exibe.

**FR-8 Trilha.** A sugestão continua sendo registrada (`recordPrioritySuggestion`) também para frio, sem bloquear nem mudar a decisão se falhar (NCC linhas 162-169).
- Given falha ao gravar a trilha, Then o lead sugerido não muda.

## 4. Requisitos não funcionais

**NFR-1 Isolamento da Execução.** Nenhum arquivo de `src/features/activities/**`, `rank-dialer-queue.ts` ou `fetch-dialer-queue.ts` é alterado, e a ordem do Power Dialer não muda (HO `escopo.fora`).
- Given o diff da entrega, When listados os arquivos, Then nenhum está nesses caminhos; e os testes existentes do Power Dialer passam sem edição.

**NFR-2 Desempenho.** A busca do próximo lead faz ordenação no banco, sem trazer a carteira inteira para a aplicação (HO `next_action`). Limite de tempo: DP-5 (o handoff não traz meta; não inventada aqui).
- Given SDR com a maior carteira (533 leads, HO), When pede a próxima ligação, Then a resposta respeita o limite definido em DP-5.

**NFR-3 Determinismo e testabilidade.** A regra de ordenação do frio é função pura, sem relógio implícito, com testes unitários (CP: módulo "PURO, deterministico").
- Given as mesmas entradas e o mesmo `now`, Then a saída é a mesma.

**NFR-4 Segurança de dados.** Leitura com filtro de `org_id` em toda consulta; sem tabela nova legível por anon; se houver migration (ex.: função SQL), RLS/EXECUTE seguem as regras do projeto (NCC: service role filtra `org_id`; memória do projeto sobre SECURITY DEFINER; CLAUDE.md do projeto: forward-only migrations, `pnpm gen:types` no mesmo PR).
- Given usuário de outra org, Then nunca vê lead de outra org.

**NFR-5 Somente leitura.** O Cockpit continua só sugerindo; nunca disca (NCC: "SOMENTE LEITURA, nunca disca").

## 5. Restrições

- **CON-1** Flag `call_priority_v2` liberada só para a V4 via `allow_org_ids`; nunca `enabled=true` global (HO; PLANO). Atenção: o `allow_org_ids` atual ainda não foi confirmado (HO `blockers`); só `enabled=false` global foi lido. Confirmar antes do rollout.
- **CON-2** Escopo travado ao Cockpit (HO, pedido).
- **CON-3** Cockpit e Execução mantêm ordens separadas (HO `decisions[3]`).
- **CON-4** Nada de ligação real, alteração em produção, flag, cron ou segredo sem aprovação explícita (PLANO "Regras gerais").
- **CON-5** Migration, se houver, aplicada antes do merge (o merge publica sozinho) (PLANO "Regras gerais").
- **CON-6** Histórico append-only; nada de `call_transcripts_v2`/`call_qualifications` é alterado (PLANO).
- **CON-7** Sem commit/push/PR sem pedido explícito do usuário (regras globais).

## 6. Métricas de sucesso (números do handoff, 15/11)

Linha de base (HO `dados_v4_15_11`):
- Sem sinal: ~96% (510/533, 494/499, 316/329, 269/283, 239/239 por SDR).
- Com sinal em 7 dias: 0 a 17 leads por SDR.
- Cadência vencida sem sinal: 30, 6, 46, 2, 15 por SDR.
- Ligações/dia (média 14d): 119, 129, 80, 71, 41; leads distintos/dia: 52, 62, 31, 23, 23 (~2 ligações por lead/dia).
- Mais de 6 tentativas em 30 dias: até 116 leads por SDR.

Metas propostas (a validar pelo usuário, o handoff não traz meta numérica):
- M1: leads distintos ligados por dia sobe frente a 52/62/31/23/23 sem queda de ligações/dia (hoje ~2 ligações por lead/dia).
- M2: % das sugestões frias com `next_step_due` vencido = 100% quando o SDR tem cadência vencida sem sinal (30, 6, 46, 2, 15).
- M3: % de sugestões frias que estão entre os 15 mais recentes por `updated_at` deixa de ser o único universo (cobertura da carteira inteira, FR-4).
- M4: zero alteração na ordem do Power Dialer (NFR-1).
- Como medir: a trilha `recordPrioritySuggestion` (FR-8) e contagem de ligações por lead/dia.

## 7. Riscos

| # | Risco | Fonte | Mitigação |
|---|-------|-------|-----------|
| R1 | Lead com muitas tentativas (até 116 leads/SDR com mais de 6 em 30d) continuar aparecendo e cansar o lead | HO | DP-2 |
| R2 | Cockpit e Power Dialer ligarem o mesmo lead no mesmo dia (3 rodadas do Power Dialer) | HO `leads_distintos_por_dia` | DP-1 (teto por dia) |
| R3 | Consulta na carteira inteira lenta | NCC | NFR-2, DP-5 |
| R4 | `allow_org_ids` da flag não confirmado: pode liberar para org errada | HO `blockers` | CON-1: confirmar antes do rollout |
| R5 | SDR confundir lead frio com quente | HO | FR-7 |
| R6 | Migration em produção sem types regenerados | CLAUDE.md projeto | NFR-4, `pnpm gen:types` |
| R7 | Mudança vazar para a Execução porque `call-priority.ts` fica em `contact-engine` (módulo compartilhado) | CP, HO | NFR-1: testes do Power Dialer sem edição; arquiteto confirma quem importa `rankLeadsByPriority` |

## 8. Decisões pendentes (não decididas por mim)

**DP-1 Teto de tentativas por lead por dia no Cockpit** (e o que conta como "tentativas recentes" em FR-3 item 2).
1. Sem teto (só a ordem de FR-3).
2. Teto de 2 por lead/dia (abaixo das 3 rodadas do Power Dialer).
3. Teto de 1 por lead/dia.
Recomendação: opção 2 (sugestão do analista, HO). Definir também a janela de "recentes" (ex.: 24h ou 7 dias).

**DP-2 Lead com mais de 6 tentativas em 30 dias.**
1. Desce de prioridade (vai para o fim dos frios).
2. Sai da fila do Cockpit.
3. Nada muda (só vale FR-3).
Recomendação: opção 1 (HO: "desce, não sai").

**DP-3 Lead só com cadência futura entra na fila do frio?**
1. Sim, entra depois dos com cadência vencida.
2. Não, só entra quem tem cadência vencida.
3. Entra só se não houver nenhum lead com cadência vencida.
Recomendação: opção 1 (a ordem de FR-3 já o coloca depois; não esvazia a fila do SDR, que liga 400/dia). Também definir onde ficam leads sem cadência nenhuma.

**DP-4 Rótulo do lead frio na tela.**
1. "Sem sinal" (descrição neutra).
2. "Lead frio".
3. "Sem leads quentes, mostrando frio".
Recomendação: opção 3 (diz o motivo ao SDR). O texto do cartão atual vem de `PRIORITY_SOURCE_LABELS`/`reasons`; confirmar com UX.

**DP-5 Tempo máximo aceitável para achar o próximo lead** (NFR-2). O handoff não traz número.
1. 500 ms.
2. 1 s.
3. 2 s.
Recomendação: opção 2, a validar com @architect após medir.

**DP-6 Confirmar `allow_org_ids` da flag `call_priority_v2`** (HO `blockers`): leitura apenas (SELECT), antes do rollout.

## 9. Próximos passos (Spec Pipeline)

1. Usuário responde DP-1 a DP-6.
2. @architect: desenho da consulta única que ordena a carteira (sem migration se possível; checar quem importa `rankLeadsByPriority`, R7).
3. @sm cria a story `cockpit-lead-frio-ordem`; @po valida.

## 10. Decisões aprovadas pelo usuário (15/11/2026)

- DP-1: teto de 2 ligações por lead por dia, valendo só para o lead frio; janela de "tentativas recentes" = 7 dias.
- DP-2: lead com mais de 6 tentativas em 30 dias desce de prioridade, não sai da fila.
- DP-3: ordem do frio = cadência vencida, depois cadência futura, depois sem cadência.
- DP-4: rótulo "Sem leads quentes, mostrando frio".
- DP-5: limite de 1 s para achar o próximo lead.
- DP-6: confirmado. `call_priority_v2` e `call_cockpit_v1` têm `allow_org_ids` = só V4.
- DP-7: frio = sem interesse real (envio/abertura de e-mail NÃO esquenta o lead). Altera o FR-1 (que dizia "score 0").
- DP-8: flag própria `cockpit_cold_order` (só V4, via `allow_org_ids`) controla a ordem nova do Cockpit. Altera o FR-6 e a CON da flag. `call_priority_v2` não é tocada, para o rollback não afetar a Execução.
