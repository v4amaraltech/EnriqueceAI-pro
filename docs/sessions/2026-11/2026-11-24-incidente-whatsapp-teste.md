# Handoff: WhatsApp automático mandou mensagem de TESTE para leads reais (24/11/2026)

O Vini recebeu o print de uma mensagem enviada às 09:52 para +55 21 97598-0954 (Priscila, M. Dias Branco): "Oi Priscila, aqui é Vinicius Mercante. Esta é uma mensagem de TESTE do envio automático de WhatsApp do Enriquece…". Pediu para analisar e parar os envios.

## Causa
- A cadência de teste **"TESTE — WhatsApp automático (Vini)"** (`960b218b-0495-4489-b3c2-d6e605471c14`) continuava **ativa** desde o teste de 07/11 (PR #513).
- Ela tinha um passo de WhatsApp com `auto_send=true` e o template de teste (`452461b3-d1f6-4001-bc20-e6a251b06290`).
- Às **12:45 UTC de 24/11**, a conta do Vini inscreveu **5 leads reais** nessa cadência em cerca de 2 s. Tudo indica uma inscrição em lote feita pela tela, escolhendo a cadência errada.
- O robô (`whatsapp-auto-send`, cron a cada minuto) funcionou como foi programado: colocou os 5 leads na fila e começou a enviar com intervalo de 2–6 min.
- Não houve bug no código. O problema foi uma cadência de teste ativa, que aparecia na lista ao inscrever leads.

## O que aconteceu com os 5 leads
| Lead | Situação |
|------|----------|
| NewprovLab | **enviada** 12:46 UTC |
| M. Dias Branco (Priscila) | **enviada** 12:52 UTC |
| Ocrim | **enviada** 12:57 UTC |
| International Meal Company | cancelada antes de sair |
| Federzoni | cancelada antes de sair |

## O que foi feito (direto no banco de produção, `dhkmonctyoaenejemkrt`)
1. Os itens `pending` da `whatsapp_send_queue` foram **cancelados** e a cadência foi **arquivada** na hora.
2. Com o OK do Vini, foram **apagados de vez**:
   - a cadência `960b218b…`, junto com seus passos, inscrições e itens da fila (via CASCADE);
   - o template `452461b3…`.
3. A pedido do Vini, foram apagados também:
   - a cadência **"TESTE Mercante Net - ciclo SDR"** (`ae4e22bd-407a-4a80-8973-91537f83327f`);
   - os 2 templates dela, "TESTE Mercante Net - email" (`17b15f6d…`) e "TESTE Mercante Net - WhatsApp" (`f77febaa…`).
4. O histórico (`interactions`) foi **mantido**: as chaves de cadência, passo e template ficaram nulas (SET NULL), mas as mensagens enviadas continuam na timeline dos leads.

**Conferido depois:** 0 passos de WhatsApp com `auto_send=true` em produção e 0 itens pendentes na fila.

## Quando o WhatsApp automático envia (resumo para consulta)
Todas as condições abaixo precisam valer ao mesmo tempo:
- O passo é de WhatsApp, com **"envio automático" ligado** e um template escolhido.
- A cadência está **ativa** e é de trabalho humano (não é `auto_email` nem da Ana/IA).
- O lead tem dono (`assigned_to`), não está marcado como "não é WhatsApp" e a inscrição está ativa, com o passo vencido.
- O envio acontece em **dia útil, das 8h às 18h (horário de Brasília)**, fora de feriados.
- A mensagem sai do número do SDR dono do lead, com 2–6 min entre envios e 3–8 s de "digitando".
- **Limite diário:**
  - começa em 20;
  - sobe 10 a cada 3 dias úteis sem problema, até 80;
  - cai 10 quando há problema;
  - no máximo 3 mensagens seguidas sem resposta.
- **Pausa sozinho** se o WhatsApp desconecta, se 3 envios falham seguidos ou se mais de 20% dos números são inválidos (com pelo menos 5 tentativas).

Hoje nenhuma cadência tem passo automático, então nada é enviado.

## Pendente (decisão do Vini)
- Falar pessoalmente com NewprovLab, M. Dias Branco e Ocrim, se achar necessário.
- Se esses 5 leads devem ser prospectados, inscrevê-los na cadência real certa.
- **Sugestão para o futuro:** testar só com cadência pausada ou com lead do próprio time, e apagar a cadência de teste logo depois.

## Repositório
- Nenhum arquivo de código foi alterado nesta sessão, nada foi commitado e não há migration.
- A memória do projeto foi atualizada (`whatsapp-evolution-paced-sending.md`).
