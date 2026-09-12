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
| **Reuniões realizadas** | Reuniões que **aconteceram** | A reunião tem carimbo de realizada (`meeting_held_at`, dado pelo feedback do closer ou pelo clique em "Ganho") e conta **na data da reunião** (`meeting_starts_at`; sem evento, no carimbo). Não olha o status: reunião realizada e lead desqualificado depois continua contando. Com filtro de vendedor, conta para o **SDR responsável** (`assigned_to`), igual ao ranking |
| **SAO** (Oportunidade Aceita por Vendas) | Reuniões realizadas que o **closer aceitou** como oportunidade qualificada | Mesmo universo, janela e filtros de "Reuniões realizadas" **e** o feedback do closer mais recente com a pergunta preenchida tem `oportunidade_qualificada = true`. Conta **na data da reunião**, não na da resposta. Reunião sem feedback (ou com feedback anterior a 09/set/2026, quando a pergunta não existia) não entra — nem como aceita nem como recusada; o card mostra "N avaliadas de M realizadas · K sem feedback do closer". Meta própria: `goals.sao_target` |

### Gráfico "Reuniões marcadas (RM) e realizadas (RR) por dia"

Logo abaixo do card de SAO. Barras lado a lado por dia + duas retas de tendência
tracejadas (regressão linear sobre os dias já ocorridos).

| Série | Conta no dia em que |
|---|---|
| **RM** (marcadas) | o SDR marcou a reunião (`meeting_scheduled_at`) |
| **RR** (realizadas) | a reunião aconteceu (`meeting_starts_at`, ou o carimbo `meeting_held_at` sem evento). Some da barra se o closer marcar no-show depois |

- É **derivado das séries diárias dos dois cards acima** (diferença do
  acumulado), então a soma das barras bate com o número grande de cada card e
  o filtro de mês/SDR/cadência é o mesmo. Dias futuros não têm barra.
- Expandir (ícone no canto) abre o gráfico maior com a tabela dia a dia.
- Código: `MeetingsByDayChart.tsx` + `utils/meetings-by-day.ts`.

---

## 2) Grid do funil (ranking por SDR)

Ordem do funil (6 cards, 3 por linha): **Abertos → Marcadas → Realizadas → SAO → Hit Rate → Taxa SAO**

| Card | Fórmula | Observações |
|---|---|---|
| **Leads Abertos** | contagem de leads abertos por SDR | 1x por lead, no mês do 1º contato. **Não conta:** notas importadas, arquivados, leads sem responsável, e eventos que não são envio (abertura, clique, resposta) |
| **Reuniões Marcadas** | leads com `meeting_scheduled_at` no período | atribuído ao responsável do lead |
| **Reuniões Realizadas** | reuniões que aconteceram no período (data da reunião + carimbo de realizada) | atribuído ao responsável do lead; sem filtro de status |
| **SAO** | realizadas do período cujo feedback do closer mais recente tem `oportunidade_qualificada = true` | atribuído ao responsável do lead; "ideal dia" pela meta individual `goals_per_user.sao_target` (fallback: meta do time ÷ SDRs) |
| **Hit Rate** | **Realizadas ÷ Abertas** (%) | conversão Aberto→Realizada. Meta **derivada** das metas de Abertos e Realizadas |
| **Taxa SAO** | **SAO ÷ Realizadas** (%) | reunião ainda sem feedback fica no denominador e puxa a taxa para baixo até o closer responder. Meta **derivada** = meta de SAO ÷ meta de Realizadas |

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
