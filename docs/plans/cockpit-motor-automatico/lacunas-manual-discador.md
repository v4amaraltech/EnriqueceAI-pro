# Lacunas: Manual do Discador V4 × motor do Cockpit

Data: 15/11/2026 (BRT). Autor: Atlas (Planejador). Pesquisa só de leitura: sem código, sem escrita no banco (só SELECT), sem git, sem ligação.

**Fontes**
- Manual: cópia em `.../scratchpad/manual-discador-v4.md`, citado como "M§n".
- Decisões: `decisoes.md`, citadas como D-x / C-x / R-x, como na spec.
- Código: branch `feat/cockpit-motor-automatico`, ainda não commitada, em `src/features/cockpit/`.
- Banco: SELECTs de 15/11 na org V4, só com contagens, sem dado pessoal.

## 0. Como ler (esclarecimento do usuário)

O manual **não** é roteiro para copiar. O "igual" é o **objetivo**: ligar mais rápido, ter o contexto do lead para falar e, com isso, ganhar volume e produtividade, conectando e qualificando. **Tudo fica registrado no Enriquece** (leads, ligações, desfechos, notas, reunião, perda), e não na planilha.

Cada regra é julgada por isso: **ajuda o objetivo? já temos? falta?** Planilha, CSV, Python, arquivo `PAUSA` e Whisper local são detalhes de implementação do manual. Aparecem só com o equivalente do Enriquece (§1).

## ⚠️ Os 3 achados que mais pesam

1. **O motor hoje não liga para lead perdido.**
   - Na V4, todo lead perdido está com `status='unqualified'`: 6.113 de 6.125, todos com `lost_at` e motivo.
   - O motor exclui esse status em três lugares: na RPC `cockpit_next_call_candidates` (migration `20261116004026`, `:82`), no portão (`services/cockpit-auto-dial.service.ts:39,260`) e no cartão (`services/next-call-card.service.ts:29`).
   - Só os perdidos de Blackbox e Leadbroker (as fontes do manual, M cabeçalho) somam **1.041**, todos com dono ativo.
   - Por SDR, os perdidos com telefone vão de 9 a 1.786. Nenhum deles entra no motor.
   - Se o objetivo inclui recuperar perdidos, esta é a lacuna nº 1.
2. **Caixa postal tira o lead do dia.**
   - A regra "atendido hoje sai do motor" (C-3, `utils/auto-dial-rules.ts:140`) usa `answered_at`. Caixa postal e filtro de chamadas também preenchem esse campo.
   - Nos últimos 30 dias, 799 das 4.328 ligações "atendidas" foram marcadas pelo SDR como caixa postal, e 2.947 duraram menos de 30 s.
   - O manual manda a caixa postal **voltar à fila** até 3 vezes (M§1.4, M§11). Hoje ela perde as tentativas 2 e 3 do dia.
   - Isso vai contra conexão e volume.
3. **O motor para no teto de 100, não no intervalo de 1 h (§2.a).**
   - Com o ritmo real (cerca de 120 ligações/h), o SDR chega a 100 ligações em menos de 1 h de motor.
   - Já houve 117 ligações/h e 414/dia por SDR na Execução. O teto de 100 do piloto (D11) é que limita o volume.

## 1. Detalhes de implementação do manual × o que o Enriquece já tem

| Manual | Para quê (no objetivo) | Equivalente no Enriquece | Falta? |
|---|---|---|---|
| Planilha "Leads perdidos" → `fila_completa.csv` (M§5.1) | De onde vem a fila | Tabela `leads` (perdidos = `status='unqualified'` com `lost_at`, `loss_reason_id` e `loss_notes`) e a RPC do #641 | **Sim:** a RPC e o portão excluem os perdidos (achado 1) |
| `discador_api4com.py` (M§3) | Discar em série | Hook `hooks/use-cockpit-auto-dial.ts` + `actions/auto-dial.ts:106-141` (API4COM `POST /calls` pelo `initiateApi4ComCall`) | Não |
| Ramal tocando no webphone e o SDR atendendo (M§1.1) | Áudio | Webphone embutido que **atende sozinho** (`X-Api4comintegratedcall`, memória `api4com-embedded-webphone`) | Não; é mais rápido que o manual |
| `card_atual.html` (M§8) | Contexto na linha | `MotorLeadSidePanel` (em construção pelo Prisma, E7b) + `utils/lead-card.ts` | Parcial (§2.b) |
| Arquivo `PAUSA` (M§5.4) | Pausar sem derrubar | Botões Pausar e Parar (`components/CockpitAutoDialBar.tsx:92,104`). Parar não derruba a ligação (FR-13) | Não |
| `resultados.csv` / `discador_log.txt` (M§3) | Histórico e retomada sem repetir | Tabela `calls` (linha criada antes do POST, `hangup_cause` e `answered_at` pelo webhook) + `interactions` (linha do tempo) | Não |
| `transcrever.py` + Whisper local (M§5.3) | Separar máquina de humano; resumo | Webhook da API4COM → transcrição ≥ 10 s → IA (`gpt-4.1`) sugere desfecho + resumo (`apply-ai-call-outcome.service.ts`), armada pelo motor (`actions/auto-dial.ts:138`). AMD ao vivo em **sombra** (`webphone_live_amd`, 80 ligações com marca em 30 dias) | Parcial: a IA sugere, mas o motor não usa "caixa postal" para devolver o lead à fila (achado 2) |
| `nao_ligar.txt` (M§6.3) | Não religar quem conversou | "Atendido hoje sai do dia" (C-3), que vale **só no dia**. `contact_holds` tem o tipo `conversa`, que o motor não usa | Parcial (§3, D-4) |
| `retornos.csv` (M§5.5) | Retorno pedido sai na hora | `scheduled_activities` (`channel='phone'`, criada pela IA no `callback_requested` ou pelo SDR); aba Retornos do Cockpit | **Sim:** o motor não lê retornos (§3) |
| Planilha J/K (M§7) | Registro do resultado | `calls.sdr_disposition` + `calls.notes` + `interactions` + reunião (`CallMeetingDialogs`) + perda (Desqualificar, `MotorLeadSidePanel.tsx:209`) | Não; o mapeamento está em §2.c |
| Claude Code "pode iniciar / liga para todos" (M§13) | Comando | Botão Iniciar motor | Não |

## 2. O objetivo, ponto a ponto

### 2.a Velocidade: "caiu, já liga a próxima" e tentativas intercaladas

**O que temos**
- 5 s de contagem entre ligações. É o mesmo "uns 5 s parado" do manual (M§1.3) e vem de `reduceAutoDial`, importado da Execução.
- As tentativas do mesmo lead já são intercaladas: o lead que não atendeu volta só depois de 1 h, e o motor liga para outros no meio (`auto-dial-rules.ts:142-145`, `cockpit-auto-dial.service.ts:139-183`).

**Números reais** (SELECT de 15/11, últimos 14 dias, org V4)

| Dado | Valor |
|---|---|
| Intervalo entre ligações seguidas do mesmo SDR (menos de 5 min) | p25 16 s · mediana 30 s · p75 54 s |
| Ligações por SDR por hora | mediana 7 · p90 50 · **máximo 117** |
| Carteira ativa com telefone, por SDR ativo (sem perdidos) | 533 · 499 · 327 · 283 · 239 · 15 · 9 |
| Com bloqueio `total`/`prospeccao` | 0 a 2 por SDR (desprezível) |
| Limite da API4COM | 15/min por ramal = 900/h (não pesa) |

**Conta** (premissa: mediana de 30 s por ciclo, cerca de 120 ligações/h no máximo):
- Pela regra de 1 h, cada lead recebe no máximo 1 ligação por hora. Para não ficar ocioso, o SDR precisa de pelo menos 120 leads liberados por hora.
- Carteiras de 239 a 533 leads: **não secam** dentro de uma hora. No dia, a capacidade é 3 × N, ou seja, de 717 a 1.599 ligações.
- **O teto de 100/dia chega antes**, com menos de 1 h de motor a 120/h.
- **A fila seca de verdade** só nas carteiras pequenas (15 e 9 leads). Elas esgotam em minutos, o motor fica em "Aguardando" até 1 h e encerra o dia depois de 3 × N ligações.
- O intervalo de 1 h também pesa num caso: **fila pequena por filtro**. Exemplo: ligar só para os perdidos de uma origem.

**Conclusão:** o intervalo de 1 h (D-Tentativas) **não** deixa o SDR ocioso nas carteiras normais. O gargalo de volume é o **teto de 100** (D11 permite subir até 400) e, no caso dos perdidos, a **exclusão do `unqualified`** (achado 1).

### 2.b Contexto: o card do manual × o nosso painel

O motor monta o card com `utils/lead-card-from-context.ts:18-45`, a partir do `CallContext`. Vários campos chegam **nulos** lá (`:31-37`), embora o banco tenha os dados.

| Campo do manual (M§8) | Nosso painel do motor | De onde viria no banco | Lacuna |
|---|---|---|---|
| Tentativa N/3 | ✅ `TENTATIVA n/3` = tentativa do dia (`lead-card-from-context.ts:38-39`) | `calls` do dia (portão: `attemptNo`) | Nenhuma |
| Nome, empresa, cargo, segmento, CNPJ, e-mail | ✅ (`:21-30`) | `leads` (decisor, empresa) | Nenhuma |
| Origem | ❌ `leadSource: null`, `canal: null` (`:31-32`) | `leads.lead_source`, `leads.canal` | **P**: levar ao contexto |
| Temperatura | ✅ parcial: usa o último contato; sem `lostAt` e `createdAt` (`:33,41`) | `leads.lost_at`, `leads.created_at` | **P** |
| SDR antigo | ❌ `null`. Não há histórico de atribuição no produto (`lead-card.ts:210-213`) | Não existe tabela de histórico de dono. Opções: último `calls.user_id` diferente do dono atual, ou `cadence_enrollments` antigas | **D-7** (fonte) |
| Motivo da perda | ❌ `lossReasonName: null` (`:34`) | `leads.loss_reason_id` → `loss_reasons.name` (6.113 perdidos com motivo) | **P** |
| Notas da perda | ❌ `null` (`:35-36`) | `leads.loss_notes` (4.643 com texto) e `cadence_enrollments.loss_notes` | **P** |
| Abertura Chris Voss por motivo | ⚠️ As 5 frases do manual (M§9) **já existem iguais** em `lead-card.ts:91-97` (PR #639), mais 11 outros motivos. No motor, sem motivo, cai na frase genérica "esta é a tentativa n de 3…" (`lead-card.ts:150-160`) | `loss_reasons.name` | **P**: basta o motivo chegar ao contexto |
| Dicas de condução (perguntas calibradas, rótulo, "não") (M§9) | ❌ | Texto fixo | P (opcional, ajuda a qualificar) |
| Status `LIGANDO` / `EM LIGAÇÃO desde HH:MM:SS` / `PAUSADO` | ⚠️ Textos de estado ("Discando…", "Em ligação", "pausada") via `describeCockpitAutoDial`, **sem a hora de início** | `calls.started_at` / estado do webphone | P |
| "Mostra quem está na linha, nunca o próximo" (M§6.5, M§11) | ✅ Tela limpa na contagem; o painel abre só em fases de ligação (`NextCallCardWithEngine.tsx:29-60,84-111`) | — | Nenhuma. O manual troca o card só no HTTP 200; nós abrimos em `dialing`, logo antes |

Motivos mais comuns entre os perdidos (sem dado pessoal): Deixou de responder 1.930 · Nunca respondeu 1.487 · Sem interesse 674 · Ex-cliente (detrator) 471 · Não ICP 415 · Contatos inválidos 321 · Sem budget 139 · Sem necessidade 113 · Sem timing 109. **Os 5 motivos do manual cobrem cerca de 70%** e já têm frase.

### 2.c Conexão e qualificação: desfechos e métricas

**Status da planilha (M§7) → onde já cabe no Enriquece**

| Manual | Enriquece hoje | Falta |
|---|---|---|
| NÃO ATENDEU (sem contato em 3) | `sdr_disposition='no_answer'` na 3ª tentativa do dia, sem avançar a cadência (`cockpit-auto-dial-outcome.service.ts:50-87`) | — |
| Caixa postal (ainda na fila) | Desfecho `voicemail` existe (`features/calls/disposition.ts:62`), mas o motor trata como "atendido" e tira o lead do dia | Achado 2 / D-1 |
| Número errado / operadora | `hangup_cause` pelo webhook; `technical_failure`; "Fora de área" (`plano-crm-autonomo.md:48-50`) | — |
| Retorno pedido | `callback_requested` → `scheduled_activities` (IA ou SDR) | O motor não puxa o retorno (D-2) |
| SEM INTERESSE | Conversa (`answered_no_progress`) e, se o SDR quiser, Desqualificar com motivo (`MotorLeadSidePanel.tsx:209`). O lead perdido já está `unqualified` | D-8 (o que fazer com perdido que diz não de novo) |
| MQL (reunião marcada) | Agendar reunião no painel (`MotorLeadSidePanel.tsx:199`, `CallMeetingDialogs`), que registra reunião e interação | Conferir o comportamento com lead `unqualified` (reabertura): **não verifiquei** |
| (vazio) conversa seguindo no WhatsApp | `relevant_conversation` + nota | — |
| Observações padronizadas (M§7, coluna K) | `calls.notes` = resumo da IA + texto do SDR | P: pré-preencher a nota de "não atendeu" no padrão do manual (D-9) |

**Métricas que já existem nos dados e podem aparecer no motor** (proposta; só dados que já existem)
- **Para o SDR, na barra do motor** (hoje só mostra "Ligações do motor nesta sessão", `CockpitAutoDialBar.tsx:75`):
  1. ligações do motor hoje, x/100 (`calls.metadata.cockpit_auto_dial`; a contagem já existe em `countMotorCallsToday`);
  2. atendidas (`answered_at`);
  3. conectadas pela regra única do produto, piso de 50 s (`features/calls/connection.ts:39,102`);
  4. caixas postais (`sdr_disposition='voicemail'`);
  5. conversas (`relevant_conversation` + `answered_no_progress` + `callback_requested`);
  6. reuniões marcadas hoje (interação de reunião do dia);
  7. retornos pendentes (`scheduled_activities` de telefone).
- **Para o gestor:** volume e conexão por SDR já existem no Dashboard e em Estatísticas (card "Ligações Realizadas", regra de conexão única). Falta só o filtro "ligações do motor" (`metadata.cockpit_auto_dial`), se ele quiser separar (D-10).
- Referência real dos últimos 14 dias: 5.266 ligações, 1.891 com `answered_at` (36%), 626 atendidas com 30 s ou mais (12%). A diferença é quase toda caixa postal e ligação curta, o que reforça o achado 2.

## 3. Tabela de lacunas, regra a regra

Esforço: P (horas), M (1–2 dias), G (3+ dias ou migration).

| Regra do manual | O que temos hoje | Situação | Conflito com decisão | Esforço | Recomendação |
|---|---|---|---|---|---|
| M§1.1 Um lead por vez, pelo ramal | Discagem serial, webphone atende sozinho (`actions/auto-dial.ts:121`) | Igual (melhor) | — | — | Manter |
| M§1.2 Card antes e durante a ligação | Painel abre em `dialing` (`NextCallCardWithEngine.tsx:29,60`) | Igual | — | — | Manter |
| M§1.3 Caiu, a próxima sai (~5 s) | Contagem de 5 s | Igual | — | — | Manter |
| M§1.4 Caixa postal/filtro/operadora → volta à fila até 3 | `answered_at` = atendido → sai do dia (`auto-dial-rules.ts:140`) | **Diferente** | **C-3** ("atendido sai do dia") | M | D-1: "atendido" passa a ser conversa; caixa postal e falha voltam à fila, contando nas 3 |
| M§1.4 Conversa → não religar | Só no dia (C-3) | Diferente | C-3 | M | D-4 |
| M§1.5 3 sem atender → "NÃO ATENDEU" | `no_answer` na 3ª (`cockpit-auto-dial-outcome.service.ts:70-82`) | Igual | — | — | Manter |
| M§6.1 Ligar para todos, inclusive SPAM/contato inválido | Exclui `unqualified` (todo perdido) e `contact_holds` `total`/`prospeccao`. A abertura de Blocklist/SPAM/Adolescente diz "não retome" (`lead-card.ts:110,145-148`) | **Diferente** | **D10** (bloqueios); escopo do #641 | G (RPC nova) | D-3 (incluir perdidos) e D-5 (motivos com restrição). Manter `contact_holds` (é pedido do lead para não ser contatado) |
| M§6.2 3 por número por dia, contado no registro antes de cada disparo | 3 por **lead** por dia, contado em `calls` no servidor a cada disparo (`cockpit-auto-dial.service.ts:224-277`). Liga só `leads.telefone` | Igual na prática (1 número por lead) | — | — | Manter |
| M§6.3 Nunca religar quem conversou | Só no dia | Diferente | C-3 | M | D-4 |
| M§6.4 Sem ocioso; intercalar | Intercalado + 1 h de intervalo. Não seca nas carteiras normais (§2.a) | Igual no efeito | D-Tentativas (1 h) | — | Manter 1 h. O gargalo é o teto (D-6) |
| M§6.5 Card mostra quem está na linha | Tela limpa na contagem | Igual | — | — | Manter |
| M§6.6 Nunca derrubar atendida | Parar não derruba (FR-13); Desligar é do SDR. A flag `webphone_voicemail_autohangup` (desligada, código compartilhado) derruba caixa postal sozinha | Igual | — | — | Manter a flag desligada |
| M§6.7 Caixa postal: desligue na hora | O SDR desliga, mas o motor fica em "confirme o desfecho" (`cockpit-auto-dial-machine.ts:47-49`) e depois tira o lead do dia | Diferente (mais lento) | C-5 (sempre clique) | P–M | Botão rápido "Caixa postal" na confirmação: grava `voicemail` e segue. Respeita C-5 (é um clique) |
| M§6.8 Situação delicada: não religar no dia | Atendido sai do dia (C-3). A nota fica com o SDR | Igual | — | — | Manter, mesmo com a mudança de D-1 (é conversa) |
| M§6.9 Registrar (na planilha) | Registro no Enriquece | Igual ao objetivo | Esclarecimento do usuário | — | Manter no Enriquece |
| M§5.4 Pausa sem derrubar | Pausar e Parar (`CockpitAutoDialBar.tsx:92,104`) | Igual | — | — | Manter |
| M§5.5 Retorno: topo da fila na hora; não sai se bloqueado | **Não temos** no motor. `scheduled_activities` (telefone) existe, mas o motor não lê; C-3 e 1 h bloqueiam retorno no mesmo dia | **Falta** | C-3 e D-Tentativas | M | D-2: retorno vencido vai ao topo, fura C-3 e 1 h, conta nas 3 e respeita bloqueio e horário |
| M§7 Status e observações | Desfechos + reunião + perda + notas (§2.c) | Igual, com lacunas pontuais | — | P | D-9 (nota padrão) |
| M§8 Card (origem, SDR antigo, motivo, notas, temperatura) | Campos nulos no motor (`lead-card-from-context.ts:31-37`) | **Falta** | — | P (menos SDR antigo) | Levar os campos ao `CallContext`; D-7 para SDR antigo |
| M§8 Status "EM LIGAÇÃO desde HH:MM:SS" | Sem a hora | Falta | — | P | Mostrar a hora de início |
| M§9 Abertura por motivo da perda | 5 frases iguais (`lead-card.ts:91-97`), mas sem motivo no motor | Falta (só ligar o dado) | — | P | Junto com o card |
| M§9 Dicas Chris Voss | Não temos | Falta | — | P | Opcional: bloco recolhível no painel |
| M§10 `POST /calls` + 424 = ramal ocupado; tenta a cada 5 s | 424: espera até 15 s, tenta **1** vez e pausa (`hooks/use-cockpit-auto-dial.ts:250-258`) | Diferente (mais conservador) | FR-15 | P | D-11 |
| M§10 Registro demora 40–60 s; sem webhook | Temos webhook (`answered_at`, `hangup_cause`) + 20 s de limite | Melhor | — | — | Manter |
| M§10 `422` número inválido → pula o lead | Qualquer erro do POST **pausa** o motor (`use-cockpit-auto-dial.ts:199,238`) | Diferente (mais lento) | FR-15 | P–M | D-12. O código de erro vem de `features/calls/**`, que não pode ser editado: só dá para reconhecer pela mensagem (frágil) |
| M§10 `duration` ≥ 15 s não garante pessoa | IA + desfecho `voicemail`; AMD em sombra | Igual em ideia | — | — | Ver D-1 |
| M§11 Card antes da 1ª ligação | ✅ | Igual | — | — | — |
| M§11 Card mostrava o próximo | ✅ não mostra | Igual | — | — | — |
| M§11 1 min parado esperando o registro | Webhook + 5 s | Igual | — | — | — |
| M§11 Reinício religou quem marcou reunião | Contagem no servidor + atendido hoje | Igual | — | — | — |
| M§11 4 ligações no mesmo número | Trava de 3 no servidor | Igual | — | — | — |
| M§11 Caixa postal contada como conversa | `answered_at` conta como atendida (achado 2) | **Igual ao erro** | C-3 | M | D-1 |
| M§11 Retorno com "número inexistente" conta como tentativa | Toda linha de `calls` conta (R-7) | Igual | — | — | — |
| M§12 "Aguardando…" com webphone offline; alerta em 15 min | Pausa na hora com motivo (FR-15) | Melhor | — | — | Manter |
| M§12 Lead conversou e voltou / era caixa postal e foi bloqueado | Não há correção manual no motor | Falta | — | P | Vem junto com D-1/D-4 (o desfecho confirmado decide) |

## 4. O menu "Discador" no Cockpit

**Hoje**
- O Cockpit tem as abas `tarefas`, `leads`, `dashboard`, `metas` e `closers` (`features/cockpit/types.ts:1`, `utils/cockpit-target.ts:21-23`).
- O item **"Discador" já aparece** na barra de abas, mas é um link para a **Execução** (`/atividades?tab=dialer`, `components/CockpitShell.tsx:91-97`).
- O motor do Cockpit vive dentro do cartão "Próxima ligação", que só aparece nas abas Tarefas, Meus Leads e Closers (`app/(app)/cockpit/page.tsx:62-63`).

**Proposta** (sem alterar a Execução; só arquivos do Cockpit)
1. Aba nova `discador` em `COCKPIT_TABS` (`types.ts:1`). O link de `CockpitShell.tsx:91-97` passa a abrir `?tab=discador` (decisão D-13 sobre manter um atalho para a Execução).
2. Tela limpa, no estilo 3CPlus. Reaproveita o que existe:
   - **Topo:** `CockpitAutoDialBar` (Iniciar, Pausar, Parar, selo SIMULADO, motivo do bloqueio) + métricas da sessão (§2.c).
   - **Centro:** o lead **na linha** (`MotorLeadSidePanel` / `lead-card`), com tentativa N/3, motivo e notas da perda, abertura e hora de início. Na contagem, só "próxima em 5 s", sem dados do próximo (M§6.5).
   - **Lateral:** fila resumida (quantos liberados agora, quantos esperando o intervalo, retornos do dia com hora) e a confirmação do desfecho com o botão rápido "Caixa postal".
   - **Seletor de fila** (se D-3 for sim): "Minha carteira" ou "Recuperação de perdidos" (com filtro de origem, ex.: Blackbox/Leadbroker).
3. O motor sai das abas Tarefas, Meus Leads e Closers e fica só na aba Discador (D-13). As outras voltam ao cartão manual de sempre.
4. Nada em `features/activities/**`, `features/calls/**` ou `features/integrations/webphone/**` (R-10).
5. **Não interfere no E7b:** a aba usa o `MotorLeadSidePanel` que o Prisma está terminando. Ela entra depois.

## 5. Decisões para o usuário

Uma decisão por item, com opções e recomendação. Nenhuma foi tomada.

1. **D-1. O que é "atendido" para tirar o lead do dia** (hoje: qualquer `answered_at`, C-3).
   - (a) Só conversa: tira do dia só quem tem `relevant_conversation`, `answered_no_progress` ou `callback_requested`. Caixa postal e falha técnica voltam à fila e contam nas 3.
   - (b) Manter como está.
   - **Recomendo (a)**: segue o manual (M§1.4) e aumenta a conexão.
2. **D-2. Retornos no motor.**
   - (a) Retorno vencido (`scheduled_activities`, telefone, pendente) entra no topo, fura "atendido hoje" e o intervalo de 1 h, conta nas 3 e respeita horário e bloqueio.
   - (b) Retorno só pela aba Retornos, manual.
   - **Recomendo (a)** (M§5.5).
3. **D-3. Leads perdidos (`unqualified`) no motor.**
   - (a) Fila separada "Recuperação de perdidos" na aba Discador, só para quem o gestor liberar.
   - (b) Misturar com a carteira na mesma prioridade.
   - (c) Não incluir.
   - **Recomendo (a)**: é o processo do manual e não mexe na ordem do #641. Exige função SQL nova (migration), porque a atual exclui `unqualified`.
4. **D-4. Quem conversou: não religar por quanto tempo.**
   - (a) Só no dia (C-3, como hoje).
   - (b) Na fila de recuperação, nunca mais depois de uma conversa (equivale a `nao_ligar.txt`).
   - (c) Por N dias.
   - **Recomendo (b) só na fila de recuperação**, mantendo (a) na carteira.
5. **D-5. Motivos com restrição** (Blocklist 36, SPAM 35, Adolescente/Criança 18; Contatos inválidos 321). O manual diz para ligar inclusive para SPAM e contato inválido (M§6.1).
   - (a) Ligar para SPAM e Contatos inválidos e **não** para Blocklist e Adolescente/Criança.
   - (b) Ligar para todos.
   - (c) Nenhum desses.
   - **Recomendo (a).** Os `contact_holds` `total`/`prospeccao` continuam bloqueando (D10).
6. **D-6. Teto do piloto.** Hoje são 100/dia (D11, até 400); o ritmo real chega a 120/h.
   - (a) Manter 100 no piloto simulado e subir para 200–400 no real, conforme a conexão medida.
   - (b) Subir já.
   - **Recomendo (a).**
7. **D-7. "SDR antigo" no card.** Não há histórico de dono.
   - (a) Último SDR que ligou para o lead, diferente do atual (`calls.user_id`).
   - (b) Omitir até existir histórico.
   - **Recomendo (a)**, com o rótulo "Último SDR que ligou".
8. **D-8. Perdido que diz "sem interesse" de novo.**
   - (a) Só desfecho + nota, e o lead continua perdido.
   - (b) Atualizar o motivo e a data da perda.
   - **Recomendo (a)**: menos escrita, e a timeline guarda a história.
9. **D-9. Nota padrão automática no "não atendeu"** ("3 tentativas sem contato em DD/MM" + causa da operadora, M§7).
   - (a) Sim, gravada com o `no_answer` da 3ª.
   - (b) Não.
   - **Recomendo (a).**
10. **D-10. Métricas.**
    - (a) Barra do motor com as 7 métricas da §2.c e o filtro "motor" nas estatísticas do gestor.
    - (b) Só a barra.
    - **Recomendo (b) primeiro.**
11. **D-11. 424 (ramal ocupado).**
    - (a) Manter: 1 nova tentativa e depois pausa.
    - (b) Tentar a cada 5 s por até 1 min, como o manual.
    - **Recomendo (b)** com o limite de 1 min: ajuda a velocidade sem laço infinito.
12. **D-12. Número inválido (422) e erros de número.**
    - (a) Pular o lead e seguir (M§10).
    - (b) Pausar (hoje).
    - **Recomendo (a)**, mas com cuidado: o motivo só é reconhecível pela mensagem de erro, porque o código está em `features/calls/**`, que é proibido.
13. **D-13. Menu.**
    - (a) Aba "Discador" própria no Cockpit, com o motor só lá. O link para a Execução sai da barra do SDR (fica para o gestor).
    - (b) Aba nova e o motor também nas outras abas.
    - (c) Manter o link para a Execução.
    - **Recomendo (a).**
14. **D-14. Ordem da fila de recuperação** (o manual segue a ordem das linhas da planilha).
    - (a) Ordem do frio do #641 (cadência, tentativas, último contato).
    - (b) Perda mais recente primeiro.
    - (c) Por origem.
    - Sem recomendação: o manual não define prioridade.

## 6. Etapas propostas (depois das decisões)

| # | Etapa | Quem | Haiku 5.5? | Depende de |
|---|---|---|---|---|
| L0 | Usuário decide D-1 a D-14 | usuário via Orquestrador | — | — |
| L1 | Adendo à `spec.md` e ao `plano-tecnico.md` (FRs novos e mudança de C-3) | Atlas | — | L0 |
| L2 | Contexto do card: levar origem, `lost_at`, `created_at`, motivo, notas e SDR antigo ao `CallContext` / `lead-card-from-context.ts` | Forge | **sim** (mapeamento de campos) | E7b do Prisma pronto |
| L3 | Regras: "atendido" = conversa (D-1), retornos no topo (D-2), 424 (D-11), 422 (D-12), nota padrão (D-9), com testes de relógio falso | Forge | parcial (testes de tabela) | L1 |
| L4 | Fila de recuperação: função SQL nova `cockpit_recovery_candidates` (`unqualified` + `lost_at`, filtros de motivo e origem, D-3/D-5/D-14), EXPLAIN e migration **só proposta** até o ok | Forge (DDL) | não | L1 |
| L5 | Aba "Discador": `COCKPIT_TABS`, `parseCockpitTab`, layout, link do `CockpitShell`, métricas da barra (D-10/D-13) e botão rápido "Caixa postal" | Prisma | parcial (textos e `data-testid`) | L2, L3 |
| L6 | Portão do diff (activities, calls, webphone) + checklist pós-implementação | Forge | **sim** | L2–L5 |
| L7 | Revisão | Sentinela | não | L6 |
| L8 | Commit e PR | Tronco, **só sob pedido** | — | L7 |
| L9 | Piloto **simulado** na aba Discador | usuário autoriza | — | L8 |
| L10 | Ensaio **real** (ainda é o ponto 9 em aberto) | só com aprovação explícita | — | L9 |

**Não verificado:** o que acontece ao agendar reunião para um lead `unqualified` (se reabre o lead e se conta em "lead aberto"). Conferir antes de L5.
