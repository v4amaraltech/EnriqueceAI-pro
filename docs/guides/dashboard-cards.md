# Cards do Dashboard "Visão Geral" — Guia para o Time

> Documento de referência das métricas exibidas no dashboard (`/dashboard`).
> Fonte: `src/features/dashboard/components/DashboardView.tsx` +
> `src/features/dashboard/services/ranking-metrics.service.ts`. As fórmulas
> abaixo são as que rodam em produção. Toda definição também está no **tooltip**
> de cada card (passar o mouse no título) — a fonte canônica dentro do produto.

O dashboard tem **3 blocos de KPI no topo** (com gráfico diário vs. meta), **2 grids
de ranking por SDR** e **gráficos de insights**. Todos respeitam o **filtro de
período** (mês ou intervalo de datas), salvo os *snapshots* indicados.

---

## 1) KPIs do topo (totais da empresa, com gráfico de pacing)

| Card | O que mede | Conta quando |
|---|---|---|
| **Leads abertos** | Leads que tiveram o **1º contato humano** no mês | 1ª interação humana do lead (e-mail, WhatsApp, telefone, LinkedIn ou **pesquisa**) cai no período |
| **Reuniões marcadas** | Leads com reunião **agendada** | `meeting_scheduled_at` cai no período |
| **Reuniões realizadas** | Reuniões que **aconteceram** (= oportunidade/ganho) | `status = 'won'` e `won_at` no período |

---

## 2) Grid do funil (ranking por SDR)

Ordem do funil: **Abertos → Marcadas → Realizadas → Hit Rate**

| Card | Fórmula | Observações |
|---|---|---|
| **Leads Abertos** | contagem de leads abertos por SDR | 1x por lead, no mês do 1º contato. **Não conta:** notas importadas, arquivados, leads sem responsável, e eventos que não são envio (abertura, clique, resposta) |
| **Reuniões Marcadas** | leads com `meeting_scheduled_at` no período | atribuído ao responsável do lead |
| **Reuniões Realizadas** | leads `won` no período | atribuído ao responsável do lead |
| **Hit Rate** | **Realizadas ÷ Abertas** (%) | conversão Aberto→Realizada. Meta **derivada** das metas de Abertos e Realizadas |

---

## 3) Grid operacional (ranking por SDR)

| Card | Fórmula | Observações |
|---|---|---|
| **Leads para Abrir** | leads `status='new'` do SDR **sem cadência ativa** | 📸 **Snapshot atual** — ignora o filtro de período. É a fila a colocar em cadência |
| **Atividades Realizadas** | interações **manuais** do SDR (por executor) | exibe **média diária** (total ÷ dias úteis). Envios automáticos da cadência e eventos do sistema **não** contam |
| **Atividades Atrasadas** | atividades de cadência vencidas há **+4h** | 📸 **Snapshot atual** — ignora o filtro. Mesma definição do badge vermelho da fila de Execução. Exclui leads ganhos/perdidos/arquivados; sex 18h não vira atrasada na seg 8h |
| **Taxa de Comparecimento** | **Realizadas ÷ Marcadas** (%) | inverso do **no-show**. Meta derivada das metas de Marcadas/Realizadas. **Pode passar de 100%** quando reuniões marcadas em meses anteriores são realizadas agora (efeito da janela do período) |

---

## 4) Gráficos de insights (complementares)

- **Motivos de Perda** — distribuição dos motivos de leads perdidos no período.
- **Conversão por Origem** — convertidos vs. perdidos por origem (Inbound Ativo / Passivo / Outbound).
- **Tempo de Resposta** — % de leads cujo 1º contato ocorreu dentro do SLA.

---

## Regras transversais (valem para todos os cards de ranking)

- **Atribuição:** cada lead conta para o **SDR responsável** (`assigned_to`), não para quem fez a ação.
- **Gerentes não aparecem** no ranking — só SDRs ativos.
- **Fuso:** todas as janelas são em **horário de Brasília (BRT)**.
- **Tempo real:** os números recalculam ao longo do dia e podem oscilar (lead reatribuído, arquivado, ou contato antigo entrando no sistema depois).
- **Snapshots** (Leads para Abrir, Atividades Atrasadas) refletem **o estado agora** e **não** mudam com o filtro de período.

---

## Notas de implementação

- **Hit Rate** e **Taxa de Comparecimento** são derivados **em memória** a partir dos
  cards de Abertos/Marcadas/Realizadas — não fazem query própria.
- Ambas as taxas usam **metas derivadas**: se a empresa espera marcar N e realizar M
  reuniões, a meta da taxa é `M / N`. Evita configurar um alvo solto e desalinhado.
- A **Taxa de Comparecimento** intencionalmente **não** trava em 100%: numerador e
  denominador são contados dentro da janela do período, então o valor pode estourar
  quando há acúmulo de reuniões de meses anteriores sendo realizadas agora. Isso é
  documentado no tooltip do card — preferimos expor o sinal a mascará-lo.
