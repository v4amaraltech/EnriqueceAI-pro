# Motor automático do Cockpit: decisões do usuário (15/11/2026)

Base: `pesquisa.md` (Atlas). Valem sobre qualquer recomendação da pesquisa.

## Decididas pelo usuário
- **Tentativas:** até 3 por lead por dia, com intervalo mínimo de 1 h entre elas ("novo horário" = intervalo, não horário marcado). Igual à Execução.
- **Quando atende:** o motor PAUSA e espera o SDR conversar. Ao fim, a IA sugere o desfecho, o SDR confirma e o motor segue sozinho para o próximo lead. (Difere da recomendação D7 da pesquisa, que seguia sozinho.)
- **Não atendeu (D6):** grava `no_answer` só na última tentativa do dia e NÃO avança a cadência pelo Cockpit.
- **Bloqueios (D10):** não liga sozinho para lead com `contact_holds` tipo `total` nem `prospeccao`.
- **Teto (D11):** 100 ligações por SDR por dia no piloto, subindo até 400.
- **Horário (D11):** seg-sex, 8h às 20h, horário de Brasília. Servidor bloqueia fora da janela.
- **Teste:** modo simulado primeiro (discador falso, sem ligar de verdade); depois ensaio real só com aprovação explícita, 1 SDR e lead de teste (Mercante Net).
- **Entrega (D13):** o PR #641 sai do rascunho e vai ao ar ANTES; o motor vem em outro PR.
- **Escopo:** só o Cockpit. O menu "Execução" (src/features/activities/**) NÃO é alterado.

## Adotadas pela recomendação da pesquisa (usuário não objetou; confirmar na spec)
- D1: COPIAR o laço do PowerDialerTab para um hook novo do Cockpit e importar só funções puras (sem editar a Execução).
- D2: o próximo lead vem da RPC do #641 no servidor, a cada lead.
- D3: regra única do motor: 3/lead/dia + 1 h de intervalo, quente e frio, contando ligações de qualquer origem.
- D5: só o telefone do decisor (como o cartão hoje).
- D8: o motor sempre começa DESLIGADO (não lembra entre recarregamentos).
- D9: flag nova `cockpit_auto_dial`, começando só para o usuário do Vini via `allow_user_ids`.
- D12: construir o modo simulado antes do ensaio real.
- Parar NÃO derruba a ligação em curso (igual à Execução).
- Feriados (`business_holidays`) bloqueados dentro da janela: ASSUMIDO, o usuário não falou; confirmar.

## Confirmadas depois do plano técnico (15/11/2026, usuário)
- Ponto 1: feriados BLOQUEIAM o motor (mesma tabela de feriados da régua de atraso), dentro da janela seg-sex 8h-20h.
- Ponto 2: o teto de 100/dia conta SÓ as ligações do motor (Execução e ligações manuais não contam).
- Pontos 3, 4 e 5: lead atendido sai do motor no dia; o SDR pode confirmar o desfecho antes de a IA terminar; o SDR SEMPRE confirma com clique, mesmo com IA de confiança alta.
- Ponto 8: criar a flag `call_cockpit_outcomes` (desligada) na mesma migration das flags `cockpit_auto_dial` (simulado) e `cockpit_auto_dial_live` (ligação real).

## Adotadas pela recomendação do Atlas (usuário não objetou; confirmar)
- Ponto 6: não inicia ligação nova depois das 19:59:59 (a janela fecha às 20h).
- Ponto 7: a contagem de tentativas por lead conta ligação de qualquer origem, inclusive atendida.
- Ponto 10: proibir também `src/features/calls/**` e `src/features/integrations/webphone/**` no diff do motor (só importar, nunca editar).

## Ainda em aberto
- Ponto 9: data do ensaio real (decisão do usuário; só com aprovação explícita).

## Decididas depois do Manual do Discador V4 (15-16/11/2026, usuário)
- O manual é a referência do OBJETIVO do motor: ligar mais rápido, mostrar o contexto do lead para falar, gerar produtividade e volume, conectar e qualificar. NÃO é roteiro para copiar linha a linha. Tudo é registrado no ENRIQUECE (nada de planilha).
- Desqualificar ou Agendar reunião no painel durante a ligação do motor: conclui sozinho e o motor segue (sem exigir "Confirmar desfecho"); nunca derruba a ligação em curso.
- Motor pausado ou bloqueado: volta o cartão completo (com "Ligar agora"); rodando = tela limpa.
- Aba "Discador" PRÓPRIA no Cockpit (hoje é só um link para a Execução), com a tela limpa do motor (barra + painel lateral do lead). A Execução continua intacta.
- Fila "Recuperação de perdidos" SEPARADA da fila normal (leads `unqualified`, hoje excluídos do motor; exige função SQL nova). Não mistura com a prioridade do #641.
- Teto diário por SDR: 400 desde o início (substitui os 100 do piloto; a flag de ligação real continua separada).
- Pendente de resposta: caixa postal volta para a fila (até 3) ou conta como atendida (regra C-3).
- Caixa postal / filtro de chamadas (resposta do usuário, 16/11): o lead VOLTA para a fila (até 3 tentativas/dia); SÓ conversa de verdade tira o lead do dia ("atendido hoje" passa a valer só para conversa real). Isso ALTERA a regra C-3 aprovada antes.
- Desvios do Forge no concludeExternally (adotados; usuário não objetou): desqualificar -> `answered_no_progress`; ligação não atendida -> `no_answer` mesmo com Agendar/Desqualificar; telemetria que não chega em ~10 s deixa o desfecho sem gravar.
- D-14 (usuário, 16/11): na fila "Recuperação de perdidos", ordem = PERDA MAIS RECENTE primeiro.
- Autorizado pelo usuário (16/11): implementar F1 a F5 localmente (sem commit, sem migration aplicada, sem ligar flag).

## Confirmadas após F1-F5 (usuário, 16/11/2026)
- Retorno agendado: CONSUMIDO por qualquer ligação ao lead depois da hora marcada; o motor NÃO escreve em scheduled_activities.
- Nota automática do não atendeu: formato CURTO "DD/MM HHhMM: não atendeu (tentativa 3/3)." (só na 3ª tentativa).
- Fila de recuperação: o painel ESCONDE "Desqualificar" quando o lead já é perdido (unqualified); usa só desfecho e nota. "Agendar reunião" continua (reabrir o lead é o objetivo). Motivo: Desqualificar em perdido reexecuta webhook, notifica gestores, pode redistribuir inbound e sobrescreve motivo/notas.
- Entregue pelo Forge e conferido: F1 teto 400, F2 conversa real (desfecho SDR > IA com confiança >= 0,7 > atendida >= 50 s), F4 retornos no topo, F5 contexto do card (leadCardExtras), 424 a cada 5 s por 1 min, 422 pula o lead. 1346 testes passando.

## Fila de recuperação: exclusões e dados (usuário, 16/11/2026)
- Motivos de perda que ficam FORA da fila de recuperação, além de Blocklist e Adolescente/Criança: Ex-cliente (detrator) (481), Duplicado (216), Engano/Não lembra (97), Pessoa Física (121) e Desqualificado pelo closer (9).
- NÃO excluídos (o usuário não marcou): Cliente e Cliente oculto (62 leads) continuam na fila. Confirmar com o usuário se foi intencional.
- Os 12 perdidos sem lost_at ficam FORA por enquanto (correção do dado depois).
- Autorizado: F7 (parte TS da fila de recuperação), tudo local, sem aplicar migration.
