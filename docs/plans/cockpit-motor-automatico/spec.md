# Spec: Motor automático de ligação no Cockpit

Data: 15/11/2026 (BRT). Autor: Atlas (Planejador). Status: rascunho para validação.
Fontes: `decisoes.md` (vale sobre tudo) e `pesquisa.md`. Cada requisito cita a fonte entre colchetes:
- [Dx] = decisão do usuário em `decisoes.md`;
- [Ax] = decisão adotada da pesquisa (`decisoes.md`, seção "Adotadas pela recomendação da pesquisa");
- [P§n] = achado da pesquisa, seção n.

- [C-n] = ponto confirmado pelo usuário depois do plano técnico (`decisoes.md`, seção "Confirmadas depois do plano técnico");
- [R-n] = ponto adotado pela recomendação do Atlas (`decisoes.md`, seção "Adotadas pela recomendação do Atlas").

Nada aqui foi inventado. Só a data do ensaio real continua em aberto (§9).

## 1. Objetivo
O SDR só aperta "Iniciar motor" no Cockpit. O sistema faz o resto:
- liga para o lead prioritário (ordem do PR #641);
- se não atender, tenta de novo pelo menos 1 h depois, até 3 vezes no dia;
- se atender, pausa até o SDR terminar e confirmar o desfecho sugerido pela IA;
- depois puxa o próximo lead sozinho.

## 2. Escopo

**Dentro**
- Motor dentro do cartão "Próxima ligação" (`src/features/cockpit/**`) e no servidor do Cockpit [D-Escopo].
- Laço copiado da Execução, importando só funções puras [A-D1].
- Próximo lead escolhido pela função do #641 no servidor, a cada lead [A-D2].
- Regra única de tentativas: 3 por lead por dia, 1 h de intervalo, quente e frio, contando ligações de qualquer origem [D-Tentativas, A-D3].
- Só o telefone do decisor [A-D5].
- Travas no servidor: horário, teto de 400 por SDR por dia, bloqueios `total` e `prospeccao` [D10, D11, M-6].
- Aba **"Discador"** própria no Cockpit e fila **"Recuperação de perdidos"** separada [M-4, M-5] (§10).
- Modo simulado antes do ensaio real [D-Teste, A-D12].
- Flag nova `cockpit_auto_dial`, que nasce desligada [A-D9].

**Fora**
- Qualquer mudança em `src/features/activities/**` (menu Execução) [D-Escopo], em `src/features/calls/**` ou em `src/features/integrations/webphone/**`. Esses dois últimos são compartilhados com a Execução: só se importa deles, nunca se edita [R-10].
- Ligar outros números do lead [A-D5].
- Avançar a cadência pelo Cockpit [D6].
- Discagem simultânea ou preditiva. A Execução também é serial [P§1.2].
- Lembrar o motor ligado entre recarregamentos [A-D8].
- Detecção de caixa postal ao vivo. `live_amd` continua só em modo sombra (`plano-crm-autonomo.md:20`).

## 3. Máquina de estados do motor

```
            ┌──────────── Parar (de qualquer estado) ─────────────┐
            ▼                                                     │
[Desligado] ──Iniciar──► [Contagem 5 s] ──► [Discando] ──► [Em ligação] ──fim──► [Conferindo atendimento]
     ▲                     ▲   │               │                                   │        │        │
     │                     │   │ (servidor     │ 424: [Liberando ramal]            │        │        │
     │                     │   │  recusa)      │  ≤15 s, 1 nova tentativa          │        │        │
     │                     │   ▼               │ erro / sem SIP:                   │        │        │
     │                     │ [Bloqueado:       │  [Pausado: motivo]                │        │        │
     │                     │  fora do horário  │                                   │        │        │
     │                     │  / teto 100 /     │      ┌─────── atendeu ────────────┘        │        │
     │                     │  sem lead]        │      ▼                                     │        │
     │                     │                   │ [Atendeu: pausado, SDR conversando]        │        │
     │                     │                   │      │ ligação termina → IA sugere,        │        │
     │                     │                   │      │ SDR confirma o desfecho             │        │
     │                     ├───────────────────┼──────┘                                     │        │
     │                     │                   │     não atendeu, tentativa 1 ou 2 ─────────┘        │
     │                     │                   │     → lead volta só após 1 h; próximo lead          │
     │                     │                   │                                                     │
     │                     │                   │     não atendeu, 3ª tentativa do dia ───────────────┘
     │                     ├── grava no_answer, próximo lead
     │                     │
     │                     └── 20 s sem sinal da operadora: [Esperando SDR] → SDR conclui → próximo
     └──── Parar: volta a Desligado, sem derrubar ligação em curso
```

| Estado | Entra quando | Sai para |
|---|---|---|
| Desligado | página carregou, ou Parar | Contagem (Iniciar) |
| Contagem 5 s | Iniciar ou fim de um lead | Discando; Bloqueado |
| Discando | contagem zerou | Em ligação; Liberando ramal (424); Pausado (erro ou SIP) |
| Em ligação | sessão SIP da aba confirmada | Conferindo atendimento |
| Conferindo atendimento | ligação terminou | Atendeu; Contagem (próximo lead); Esperando SDR (20 s) |
| Atendeu (pausado) | operadora confirma `answered_at` | Contagem, depois de o SDR confirmar o desfecho |
| Esperando SDR | 20 s sem sinal | Contagem, depois de o SDR concluir |
| Aguardando | todos os elegíveis dentro do intervalo de 1 h | Contagem, na hora liberada |
| Bloqueado | servidor recusa: fora do horário, teto, sem lead | Desligado. O SDR inicia de novo |
| Pausado | erro, SIP ausente, 424 repetido, Pausar | Contagem (Retomar) |

## 4. Requisitos funcionais

**FR-1 Iniciar só com clique** [A-D8, P§5]
- Dado a flag ligada para o SDR,
- quando ele abre ou recarrega o Cockpit,
- então o motor está Desligado e nada é discado até ele clicar "Iniciar motor".

**FR-2 Flag desligada** [A-D9, C-8]
- Dado `cockpit_auto_dial` **ou** `call_cockpit_outcomes` desligada para o SDR,
- quando ele abre o Cockpit,
- então o botão do motor não aparece, as actions do motor recusam no servidor e o cartão funciona como hoje.

**FR-3 Próximo lead pelo #641** [A-D2, D13]
- Dado o motor ligado,
- quando chega a vez de um novo lead,
- então o servidor escolhe pela ordem do #641: quente confirmado primeiro, senão o menor `cold_rank`.

**FR-4 Até 3 tentativas por lead por dia** [D-Tentativas, A-D3, R-7]
- Dado um lead com 3 ligações hoje (dia de Brasília, qualquer origem: Cockpit, Execução, página do lead; atendidas também contam),
- quando o servidor escolhe o próximo,
- então esse lead não é escolhido, seja quente ou frio.

**FR-5 Intervalo de 1 h** [D-Tentativas]
- Dado um lead ligado há menos de 1 h (qualquer origem),
- quando o servidor escolhe o próximo,
- então esse lead não é escolhido.
- Se ninguém estiver liberado, o motor mostra "Aguardando: próxima ligação liberada às HH:MM" e volta sozinho nessa hora [P§1.3].

**FR-6 Não atendeu, tentativa 1 ou 2** [D6, D-Tentativas]
- Dado que o lead não atendeu e esta foi a 1ª ou a 2ª ligação dele hoje,
- quando a operadora confirma (`hangup_cause` sem `answered_at`),
- então nada é gravado como desfecho, a cadência não avança e o motor segue para o próximo lead após 5 s.

**FR-7 Não atendeu, 3ª tentativa** [D6]
- Dado que o lead não atendeu na 3ª ligação do dia,
- quando a operadora confirma,
- então `calls.sdr_disposition = 'no_answer'` é gravado na mesma linha da ligação, a cadência **não** avança e o motor segue para o próximo.

**FR-8 Atendeu: pausa** [D-Quando atende]
- Dado que o lead atendeu,
- quando a operadora confirma `answered_at`,
- então o motor pausa ("Em conversa") e não disca ninguém até o SDR confirmar o desfecho.

**FR-9 IA sugere, SDR sempre confirma** [D-Quando atende, C-4, C-5]
- Dado uma ligação atendida e encerrada,
- quando a sugestão da IA chega,
- então o cartão mostra o desfecho sugerido já marcado.
- O SDR pode confirmar ou trocar. Ao confirmar, o desfecho é gravado em `calls.sdr_disposition` e o motor volta à contagem para o próximo lead.
- O SDR **pode confirmar antes de a IA terminar**, escolhendo o desfecho sozinho [C-4].
- O motor **nunca segue sem o clique**, mesmo com a IA de confiança alta [C-5].
  - Nota técnica: a cadeia de IA (em `features/calls/**`, que não pode ser editada) continua gravando sozinha quando está confiante.
  - A confirmação do SDR regrava o desfecho se ele trocar. O clique é o que libera o motor.

**FR-9b Só conversa real tira o lead do dia** [C-3 alterada por M-1, R-7]
- Dado um lead com **conversa real** hoje (dia de Brasília, qualquer origem; definição exata em §10.1),
- quando o servidor escolhe o próximo,
- então esse lead não volta ao motor no resto do dia.
- Caixa postal, filtro de chamadas, falha técnica e "não atendeu" **não** tiram o lead do dia. Ele volta à fila respeitando 3/dia e o intervalo de 1 h (FR-4/FR-5).
- Texto antigo (C-3, 15/11), substituído em 16/11: "ligação atendida hoje (`answered_at`)".

**FR-10 Bloqueios de contato** [D10]
- Dado um lead com `contact_holds.tipo` `total` ou `prospeccao`,
- quando o servidor escolhe o lead **e** de novo na hora de discar,
- então ele não é discado.
- Se o bloqueio surgiu entre a escolha e a discagem, o motor pula para o próximo.

**FR-11 Horário e feriados** [D11, C-1, R-6]
- Dado o horário de Brasília fora de seg–sex, 08:00:00–19:59:59, **ou** dia de feriado nacional (mesma lista da régua de atraso: `business_holidays` / `src/lib/utils/br-holidays.ts`),
- quando o motor tenta discar,
- então o servidor recusa e o motor vai para Bloqueado ("fora do horário" ou "feriado").
- Nenhuma ligação nova começa a partir das 20:00:00 [R-6].
- Uma ligação já em curso termina normalmente.

**FR-12 Teto diário** [D11, C-2, M-6]
- Dado que o SDR já fez **400** ligações **pelo motor** hoje (Execução e ligações manuais não contam; as duas filas do motor somam),
- quando o motor tenta discar,
- então o servidor recusa e o motor vai para Bloqueado ("teto do dia").
- 400 vale desde o início (M-6, substitui os 100 do piloto). A ligação real continua exigindo a flag própria (CON-6).

**FR-13 Parar** [A-Parar, P§1.5]
- Dado o motor em qualquer estado,
- quando o SDR clica "Parar",
- então nenhuma nova ligação é iniciada e o motor volta a Desligado.
- A ligação em curso **não** é derrubada: o botão Desligar continua separado.

**FR-14 Pausar e retomar** [P§1.5]
- Dado o motor em Contagem,
- quando o SDR clica Pausar,
- então a contagem para. "Retomar" volta à contagem do mesmo lead.

**FR-15 Erros de ramal e SIP** [P§1.3, P§5]
- Webphone não registrado, microfone negado, ramal em outra aba, POST sem sessão SIP nesta aba em 2 s, ou erro da API4COM → o motor pausa com o motivo e **não** repete sozinho.
- No 424, espera até 15 s e tenta **1** vez; se repetir, pausa.

**FR-16 Sem sinal da operadora** [P§1.3]
- Dado 20 s sem sinal de atendimento após o fim,
- então o motor espera o SDR concluir e não segue sozinho.

**FR-17 Excluídos da sessão** [P§2]
- Dado um lead pulado pelo SDR nesta sessão (o atendido já sai pelo FR-9b),
- quando o servidor escolhe o próximo,
- então esse lead não volta na mesma sessão.
- A lista acumula, ao contrário do `skip` único de hoje.

**FR-18 Modo simulado** [D-Teste, A-D12]
- Dado o motor ligado sem a liberação de ligação real,
- quando chega a vez de discar,
- então nenhuma chamada vai à API4COM, nenhuma linha é criada em `calls` e o atendimento é simulado.
- A tela mostra o selo "SIMULADO" o tempo todo.

## 5. Requisitos não funcionais

| ID | Requisito | Fonte |
|---|---|---|
| NFR-1 | Escolher o próximo lead em até 1 s (p95) na maior carteira (533 leads). Hoje a RPC leva 46,6 ms | `cockpit-lead-frio/spec.md`, pesquisa do #641 |
| NFR-2 | Uma ligação por vez por SDR (serial) e no máximo 15 por minuto por ramal | P§1.2, memória `api4com-embedded-webphone` |
| NFR-3 | Toda trava (flag, horário, teto, bloqueio, tentativas) decidida **no servidor**; o navegador só mostra | D11, P§5 |
| NFR-4 | Erro ao ler bloqueio, flag ou contagem = **não disca** (falha fechada) | `next-call-card.service.ts:101-104` (mesmo padrão) |
| NFR-5 | `calls.status` nunca escrito pelo app; o desfecho vai em `sdr_disposition` | memória `call-outcome-sdr-vs-technical-status` |
| NFR-6 | O diff não toca `src/features/activities/**`, `src/features/calls/**` nem `src/features/integrations/webphone/**` | D-Escopo, R-10 |
| NFR-7 | Testes do laço com relógio falso e sem rede, como `PowerDialerTab.auto.test.tsx` | P§5 |

## 6. Restrições

| ID | Restrição | Fonte |
|---|---|---|
| CON-1 | O PR #641 vai ao ar antes; o motor vem em outro PR | D13 |
| CON-2 | Nada de ligação real sem aprovação explícita; ensaio só com 1 SDR (Vini) e o lead de teste Mercante Net | D-Teste, `plano-crm-autonomo.md:18` |
| CON-3 | Flag liberada só por `allow_user_ids`/`allow_org_ids`, nunca com `enabled=true` global | `plano-crm-autonomo.md:16` |
| CON-4 | Migration aplicada antes do merge (o merge publica sozinho) | `plano-crm-autonomo.md:17` |
| CON-5 | Rollback = desligar a flag do motor, sem afetar a Execução nem `call_priority_v2` | D9, achado A2 do #641 |
| CON-6 | Uma migration cria 3 flags desligadas, com `allow_org_ids` vazio: `call_cockpit_outcomes`, `cockpit_auto_dial` (motor simulado) e `cockpit_auto_dial_live` (ligação real). O motor só aparece com `call_cockpit_outcomes` **e** `cockpit_auto_dial` ligadas para o usuário; liga de verdade só com as três | C-8 |

## 7. Métricas
Medidas no piloto, por SDR e por dia, só das ligações do motor (marcadas em `calls.metadata`):
- ligações discadas pelo motor (comparar com o teto de 400);
- taxa de atendimento (`answered_at` não nulo);
- tentativas por lead no dia (nenhum lead com mais de 3) e intervalo mínimo entre tentativas (nenhum abaixo de 1 h). São checagens de regra, o alvo é zero violações;
- ligações fora da janela ou em lead bloqueado (alvo: zero);
- tempo entre o fim de uma ligação e o início da próxima;
- acerto da IA: confirmações sem troca ÷ total de confirmações.

## 8. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Ligação real por engano no piloto | Lead incomodado | Modo simulado por padrão. Ligação real exige uma 2ª flag (ver plano técnico) |
| Laço copiado diverge da Execução | Dois comportamentos | Testes próprios travam o comportamento do Cockpit. As funções puras importadas têm teste na Execução |
| Mudanças não commitadas na Execução neste floor (`DialerStats` sem `leadsWithSnooze`, aviso do webphone que o SDR pode fechar) | Import quebrar | O plano não importa `DialerStats` nem `fetch-dialer-queue`. O motor mostra o próprio motivo de pausa, sem depender do aviso do webphone |
| Teto × volume real: há SDR com 414 ligações num dia nos últimos 30 dias e pico de 117/h (SELECT de 15/11) | Com 100, o motor bloquearia em menos de 1 h | Teto de 400 [M-6], contando só as ligações do motor [C-2] |
| Quente sem teto no #641 | Ligar várias vezes ao quente | FR-4/FR-5 valem para o quente também |
| Mesmo SDR com Execução e Cockpit ao mesmo tempo | Disputa do ramal | Contagem de qualquer origem (FR-4/5). Bloquear Iniciar se houver ligação integrada em curso |
| Sinal da operadora atrasado ou ausente | Motor parado | FR-16: espera o SDR |
| Feriado | Liga em dia sem expediente | Bloqueado no servidor [C-1] |

## 9. Decisões fechadas e ponto em aberto

**Fechadas** (eram os "pontos a confirmar"):

| # | Decisão | Fonte | Onde entra |
|---|---|---|---|
| 1 | Feriados nacionais bloqueiam o motor (mesma lista da régua de atraso) | C-1 | FR-11 |
| 2 | O teto diário conta **só** as ligações do motor (valor: 400, ver M-6) | C-2 | FR-12 |
| 3 | ~~Lead atendido sai do motor no resto do dia~~ → **alterada em 16/11:** só conversa real tira do dia (M-1) | C-3 → M-1 | FR-9b, §10.1 |
| 4 | O SDR pode confirmar o desfecho antes de a IA terminar | C-4 | FR-9 |
| 5 | O SDR sempre confirma com clique, mesmo com a IA de confiança alta | C-5 | FR-9 |
| 6 | Nenhuma ligação nova começa a partir das 20:00:00 | R-6 | FR-11 |
| 7 | Tentativas contam ligação de qualquer origem, inclusive atendida | R-7 | FR-4, FR-9b |
| 8 | Criar `call_cockpit_outcomes` desligada na mesma migration das flags do motor | C-8 | CON-6 |
| 10 | `features/calls/**` e `features/integrations/webphone/**` também proibidos no diff | R-10 | Escopo "Fora", NFR-6 |

**Em aberto:**
9. **Data do ensaio real.** É decisão do usuário, só com aprovação explícita: 1 SDR (Vini) e o lead de teste Mercante Net, em horário comercial.
- **D-14. Ordem da fila "Recuperação de perdidos"** (§10.4).

## 10. Adendo de 16/11: decisões depois do Manual do Discador V4

Fontes:
- **M-n**: `decisoes.md`, seção "Decididas depois do Manual do Discador V4", decisão do usuário.
- **A-Dn**: "adotada pela recomendação" do relatório `lacunas-manual-discador.md` §5.

O manual é a referência do **objetivo** (ligar mais rápido, ter contexto do lead, volume, conexão e qualificação), não um roteiro. Tudo é registrado no Enriquece [M-0].

### 10.0 Decisões fechadas

| # | Decisão | Fonte | Requisito |
|---|---|---|---|
| M-0 | O manual é referência do objetivo; nada de planilha, tudo no Enriquece | usuário | — |
| M-1 | Caixa postal e filtro de chamadas voltam à fila (até 3/dia); só conversa real tira do dia. **Altera C-3** | usuário 16/11 | FR-9b, §10.1 |
| M-2 | Desqualificar ou Agendar reunião no painel durante a ligação conclui sozinho e o motor segue, sem "Confirmar desfecho" e sem derrubar a ligação | usuário | FR-19 |
| M-3 | Motor pausado ou bloqueado = cartão completo (com "Ligar agora"); rodando = tela limpa | usuário | FR-20 |
| M-4 | Aba "Discador" própria no Cockpit (hoje é link para a Execução); a Execução continua intacta | usuário | FR-21, §10.3 |
| M-5 | Fila "Recuperação de perdidos" separada (leads `unqualified`), com função SQL nova, sem misturar com a prioridade do #641 | usuário | FR-22, §10.2 |
| M-6 | Teto de 400 por SDR por dia desde o início; a flag de ligação real continua separada | usuário | FR-12 |
| M-7 | Desvios do Forge no `concludeExternally`: desqualificar grava `answered_no_progress`; ligação não atendida grava `no_answer` mesmo com Agendar ou Desqualificar; telemetria que não chega em ~10 s deixa o desfecho sem gravar | adotados (usuário não objetou) | FR-19 |
| A-D2 | Retorno vencido vai para o topo: fura "conversa hoje" e o intervalo de 1 h, conta nas 3 e respeita horário e bloqueio | adotada pela recomendação | FR-23 |
| A-D4 | Quem teve conversa real **depois da perda** sai da fila de recuperação para sempre (na carteira normal, só no dia) | adotada pela recomendação | FR-22 |
| A-D5 | Recuperação liga para SPAM e Contatos inválidos; **não** liga para Blocklist e Adolescente/Criança. `contact_holds` `total`/`prospeccao` continuam bloqueando | adotada pela recomendação | FR-22 |
| A-D7 | "SDR antigo" no card = último usuário que ligou para o lead e não é o dono atual, com o rótulo "Último SDR que ligou" | adotada pela recomendação | FR-24 |
| A-D8 | Perdido que diz "sem interesse" de novo: só desfecho e nota; o lead continua perdido | adotada pela recomendação | FR-19 |
| A-D9 | Na 3ª tentativa sem atender, nota automática "3 tentativas sem contato em DD/MM." + motivo da operadora quando houver | adotada pela recomendação | FR-25 |
| A-D10 | Métricas só na barra do motor, para o SDR (o filtro do gestor fica para depois) | adotada pela recomendação (b) | FR-26 |
| A-D11 | 424 (ramal ocupado): nova tentativa a cada 5 s por até 1 min; depois pausa | adotada pela recomendação (b) | FR-15 (alterado) |
| A-D12 | Erro 422 (número inválido): pula o lead e segue, em vez de pausar | adotada pela recomendação | FR-27 |

### 10.1 Regra exata de "conversa real" (substitui C-3)

Uma ligação de hoje (dia BRT, qualquer origem) é **conversa real** se valer a **primeira** regra que tiver dado:
1. **O SDR marcou o desfecho** (`calls.sdr_disposition`):
   - é conversa se for `relevant_conversation`, `answered_no_progress` ou `callback_requested`;
   - **não** é conversa se for `voicemail`, `no_answer` ou `technical_failure`.
   - No motor, toda ligação atendida passa por aqui, porque o SDR sempre confirma (C-5) ou conclui por Agendar/Desqualificar (M-2, M-7).
2. **Sem desfecho do SDR, a IA marcou** (`calls.metadata.ai_outcome.disposition`): os mesmos dois grupos.
3. **Sem nenhum dos dois**, usa-se a regra de "conectada" que o produto já tem: `answered_at` preenchido **e** duração ≥ 50 s (`features/calls/connection.ts:39,102`).

**Limite de acerto, com dados reais** (SELECT de 16/11: ligações atendidas da V4 em 60 dias que têm desfecho do SDR):

| Desfecho do SDR | Ligações | Com 50 s ou mais | Mediana |
|---|---|---|---|
| Caixa postal | 1.835 | 154 (8,4%) | 7 s |
| Falha técnica | 252 | 31 (12%) | 9 s |
| Conversa (relevante + sem avanço + pediu retorno) | 217 | 130 (60%) | 50–168 s |
| Sem desfecho do SDR | 5.819 | 1.422 (24%) | 14 s |

- **No motor**, a regra 1 é exata: o desfecho vem do clique do SDR.
- **Nas ligações de fora do motor sem desfecho** (5.819 em 60 dias), só sobra a regra 3:
  - cerca de **8%** das caixas postais longas contariam como conversa e tirariam o lead do dia, por engano e para o lado seguro (liga menos);
  - cerca de **40%** das conversas curtas (menos de 50 s) não seriam vistas, e o lead poderia ser religado no mesmo dia.
- **IA:** só 5 ligações com desfecho da IA em 60 dias. Hoje ela não ajuda fora do motor.
- **AMD ao vivo:** 27 ligações em modo sombra. Não é usado: está em teste e não pode decidir nada (`plano-crm-autonomo.md:20`).
- Não existe sinal melhor hoje sem editar `features/calls/**` (proibido, R-10).

### 10.2 Fila "Recuperação de perdidos" [M-5, A-D4, A-D5]

- **Quem entra:**
  - lead da **própria carteira** do SDR (`assigned_to` ou `closer_id` = SDR; a mesma regra de dono do portão);
  - `status='unqualified'` com `lost_at` preenchido, sem `deleted_at`, com telefone;
  - sem `contact_holds` `total`/`prospeccao`;
  - motivo da perda diferente de Blocklist e Adolescente/Criança;
  - **sem conversa real depois de `lost_at`** (§10.1, A-D4).
- **Valem as mesmas travas do motor:** 3/dia, 1 h, conversa hoje, horário, feriado e teto de 400 somando as duas filas.
- **É outra função SQL**, sem mexer na ordem do #641 (M-5). Ordem: D-14, em aberto.
- **Volume** (SELECT de 15/11): por SDR ativo, de 9 a 1.786 perdidos com telefone. Só Blackbox e Leadbroker somam 1.041.
- **A conferir antes da tela:** o que acontece ao agendar reunião para um lead `unqualified` (reabre? conta como "lead aberto"?). Fica na etapa F3 do plano.

### 10.3 Aba "Discador" (desenho mínimo) [M-3, M-4]

- O item "Discador" das abas do Cockpit deixa de apontar para `/atividades?tab=dialer` e abre `?tab=discador`. Só muda o link do Cockpit (`CockpitShell.tsx:91-97`); nenhum arquivo da Execução muda.
- **Na aba:**
  - seletor de fila ("Minha carteira" ou "Recuperação de perdidos"). O motor roda **uma fila por vez**;
  - a barra do motor;
  - com o motor rodando: tela limpa e painel lateral do lead na linha;
  - parado, pausado ou bloqueado: cartão completo (M-3).
- **O motor sai das abas Tarefas, Meus Leads e Closers**, que voltam ao cartão manual de antes.
  - Leitura de M-4 ("aba própria, com a tela limpa do motor"). Se o usuário quiser o motor também nas outras abas, basta não remover.

### 10.4 D-14: ordem da fila de recuperação (em aberto, 2 opções)

**(A) Perda mais recente primeiro** (`lost_at` desc; empate: nunca ligado antes, depois a ligação mais antiga).
- Prós: quem foi perdido há pouco ainda lembra da V4 e a dor ainda é atual, então tende a atender e a conversar mais (objetivo: conexão e qualificação). É simples de explicar ao SDR ("os mais frescos primeiro").
- Contras: os perdidos antigos quase nunca chegam na vez. Numa carteira de 1.786 perdidos, a cauda fica parada.

**(B) Menos tentado primeiro** (menos ligações nos últimos 30 dias; depois nunca ligado; depois a ligação mais antiga; empate pela perda mais recente). É o mesmo espírito do frio do #641 (DP-1/DP-2), mas numa função própria.
- Prós: espalha as ligações pela base inteira, e todo perdido recebe a sua chance (objetivo: volume e cobertura). Evita gastar as tentativas sempre nos mesmos.
- Contras: mistura perdidos de 1 ano com os de ontem; a taxa de conversa pode cair no começo.

Sem dado de conversão por idade da perda hoje, as duas são defensáveis. **(A)** puxa conexão no curto prazo; **(B)** puxa cobertura.

### 10.5 Requisitos novos

**FR-19 Concluir por Agendar ou Desqualificar** [M-2, M-7, A-D8]
- Dado uma ligação do motor,
- quando o SDR agenda reunião ou desqualifica pelo painel,
- então o desfecho é gravado e o motor segue sem "Confirmar desfecho", sem derrubar a ligação em curso.
- Gravação: desqualificar = `answered_no_progress`; não atendida = `no_answer`; sem telemetria em ~10 s, nada é gravado.
- "Sem interesse" de um perdido = só desfecho e nota (A-D8).

**FR-20 Cartão por estado** [M-3]
- Motor pausado ou bloqueado → cartão completo com "Ligar agora".
- Rodando → tela limpa.

**FR-21 Aba Discador** [M-4]
- Dado a flag do motor ligada para o SDR,
- quando ele clica em "Discador" no Cockpit,
- então abre a aba própria com o motor, sem ir para a Execução.

**FR-22 Fila de recuperação** [M-5, A-D4, A-D5]
- Dado a fila "Recuperação de perdidos" escolhida,
- quando o servidor escolhe o próximo,
- então só entram os leads de §10.2, na ordem decidida em D-14.

**FR-23 Retorno vencido no topo** [A-D2]
- Dado um retorno de ligação pendente (`scheduled_activities`, `channel='phone'`, `status='pending'`, `scheduled_at` ≤ agora) de um lead da fila escolhida,
- quando o servidor escolhe o próximo,
- então esse lead vem primeiro.
- Fura "conversa hoje" e o intervalo de 1 h, conta nas 3 tentativas e respeita horário, feriado, teto e bloqueios.

**FR-24 Contexto no card** [A-D7, lacunas §2.b]
- O painel do motor mostra:
  - origem (`leads.lead_source` / `canal`);
  - data da perda (`lost_at`);
  - motivo da perda (`loss_reasons.name`);
  - notas da perda (`leads.loss_notes`, senão `cadence_enrollments.loss_notes`);
  - "Último SDR que ligou";
  - a abertura pelo motivo da perda (frases já existentes em `lead-card.ts:91-109`);
  - a hora de início da ligação.

**FR-25 Nota padrão do "não atendeu"** [A-D9]
- Na 3ª tentativa sem atender, a nota gravada é "3 tentativas sem contato em DD/MM." + o motivo da operadora, se houver (`hangupReasonLabel`, `integrations/webphone/webphone-lead-answer.ts:122`, só import).

**FR-26 Métricas na barra** [A-D10]
- A barra mostra, no dia: ligações do motor x/400, atendidas, conectadas (regra de 50 s), caixas postais, conversas, reuniões marcadas e retornos pendentes.
- Só com dados que já existem (lacunas §2.c).

**FR-15 alterado: 424** [A-D11]
- Ramal ocupado: nova tentativa a cada 5 s por até 1 min, e depois pausa com o motivo.

**FR-27 Número inválido** [A-D12]
- Erro 422 da API4COM: o lead vai para os excluídos da sessão e o motor segue para o próximo, sem pausar.
- Limite: o 422 só é reconhecível pela mensagem de erro, porque o código está em `features/calls/**`, que não pode ser editado.
