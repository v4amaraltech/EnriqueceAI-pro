# Competitive Analysis

> Full report: `docs/research/competitive-intelligence-report.md`

## Market Landscape

O mercado global de Sales Engagement está avaliado em ~USD $9-10 bilhões (2025), com projeção de USD $25-36 bilhões até 2033 (CAGR 13-16%). No Brasil, o TAM estimado é de R$500M-1B/ano, com SAM de R$200-400M/ano para o ICP do EnriqueceAI (Startups, PMEs e Mid-market B2B).

## Competitive Positioning

| Dimensão | **EnriqueceAI** | **Meetime** | **Exact Spotter** | **Apollo.io** |
|----------|:-:|:-:|:-:|:-:|
| WhatsApp Nativo | ✅ 1st class | ⚠️ Básico | ✅ Integrado | ❌ |
| IA Geração de Mensagens | ✅ | ❌ | ❌ | ⚠️ Básico |
| Enrichment CNPJ | ✅ Nativo | ❌ | ❌ | ❌ |
| Discador/Telefone | ❌ (futuro) | ✅ | ✅ | ✅ |
| Base de Contatos | ❌ | ❌ | ⚠️ Big Data | ✅ 210M+ |
| CRM (HubSpot/Pipedrive/RD) | ✅ | ✅ | ❌ | ✅ (sem RD) |
| Idioma PT-BR | ✅ | ✅ | ✅ | ❌ |
| Custo de Implementação | R$0 | Não público | R$5.000 | R$0 |

## Key Competitive Gaps Exploited

1. **Nenhum concorrente brasileiro integra WhatsApp + IA generativa + Enrichment CNPJ** numa única solução
2. **Meetime** não tem IA para geração de mensagens (apenas transcrição de calls) e WhatsApp é canal secundário
3. **Exact Spotter** cobra R$5.000 de implementação e R$211/usuário adicional — barreira para PMEs
4. **Apollo.io** não tem WhatsApp, dados fracos para empresas brasileiras, preço em USD

## CNPJ Enrichment Strategy (Camadas)

| Camada | Provider | Dados | Custo | Plano EnriqueceAI |
|--------|----------|-------|-------|-----------|
| **Básica** | CNPJ.ws / ReceitaWS | Razão social, CNAE, endereço, porte, situação | Gratuito (rate limited) | Starter |
| **Contato** | Lemit | Emails, telefones validados, sócios, faturamento | Sob consulta (pré/pós-pago) | Pro |
| **Premium** | Serasa / CPF.CNPJ | Score de crédito, risco financeiro | Premium | Enterprise (futuro) |

## WhatsApp Business API — Custos

| Tipo de Mensagem | Custo/msg (Brasil) | Uso na Plataforma |
|-----------------|-------------------|-------------------|
| Marketing | ~R$0,35 | Outbound frio (primeiro contato via template) |
| Utilidade | ~R$0,05 | Confirmações, follow-ups |
| Serviço (24h) | Grátis (a partir jul/2025) | Respostas a leads |

**Implicação:** Custos de WhatsApp API devem ser repassados como créditos incluídos por plano, com cobrança por excedente.

## Pricing Strategy

| Plano | Base (3 SDRs + 1 Gerente) | Adicional/usuário | Enrichment | IA/dia | WhatsApp/mês |
|-------|--------------------------|-------------------|-----------|--------|-------------|
| **Starter** | R$149/mês | +R$49/user | Básico (Receita Federal) | 50 gerações | 500 msgs |
| **Pro** | R$349/mês | +R$89/user | Contato (Lemit) + CRM | 200 gerações | 2.500 msgs |
| **Enterprise** | R$699/mês | +R$129/user | Full + todas integrações | Ilimitado | 10.000 msgs |

*Posicionado abaixo da Meetime (~R$200-400/user) e sem custo de implementação (vs Exact R$5.000).*

## Success Metrics & KPIs

| KPI | Baseline (Mercado) | Meta EnriqueceAI (12 meses) |
|-----|-------------------|---------------------|
| Conversão lead → reunião | 5-8% (média BR) | 12-15% (com IA + WhatsApp) |
| Produtividade SDR (leads/dia) | 30-50 | 80-120 (com enrichment + IA) |
| Taxa de resposta WhatsApp | 40-60% (mercado) | 50-70% (com personalização IA) |
| Taxa de resposta Email | 5-10% (cold outreach) | 10-15% (com personalização IA) |
| Churn mensal | 5-8% (SaaS BR) | <5% |
| NPS | 30-50 (Meetime benchmark) | >50 |
| MRR ao final de 12 meses | - | R$50.000+ |
