# Handoff — 2026-03-10: Enriquecimento Individual Apollo + Backfill

## O que foi feito

### 1. Enriquecimento individual de lead via Apollo
- **Nova action**: `src/features/leads/actions/enrich-lead-apollo.ts`
  - `enrichLeadWithApollo(leadId)` → chama Apollo People Match API
  - Merge inteligente: só preenche campos vazios (email, job_title, linkedin, website, razao_social, nome_fantasia, porte)
  - Salva `source_id` (Apollo person ID) para webhook matching
  - Dispara phone reveal async via webhook
- **UI**: Novo item "Enriquecer com Apollo" no dropdown do lead detail
  - `LeadDetailHeader.tsx` — nova prop `onEnrichApollo`, label existente renomeado para "Enriquecer (CNPJ)"
  - `LeadDetailLayout.tsx` — novo handler `handleEnrichApollo`

### 2. Fix nome_fantasia
- **Problema**: `nome_fantasia` nunca era preenchido pelo Apollo (nem no import nem no enrichment individual)
- **Fix**: Ambos os fluxos agora setam `nome_fantasia` a partir de `organization.name`
- **Arquivos**: `enrich-lead-apollo.ts`, `import-apollo-leads.ts`

### 3. Backfill source_id para leads antigos
- **Problema**: 60 leads importados antes da coluna `source_id` existir (07/Mar) não tinham `source_id`, impedindo o webhook de phone reveal de entregar telefones
- **Solução**: Criado `backfill-apollo-source-id.ts` (server action reutilizavel) + endpoint temporario (já removido) para executar
- **Resultado do backfill**:
  - 60/60 leads atualizados com `source_id`
  - 59/63 leads Apollo agora têm telefone (antes eram 4)
  - 2 leads com 2 telefones, 57 com 1, 4 sem (Apollo não tem dados)

## Commits

| Hash | Mensagem |
|------|----------|
| `de15332` | feat: add individual lead enrichment via Apollo |
| `52ea6be` | fix: also fill nome_fantasia from Apollo organization name |
| `40f00f5` | fix: backfill Apollo source_id and fill nome_fantasia on import |

## Arquivos criados/modificados

| Arquivo | Acao |
|---------|------|
| `src/features/leads/actions/enrich-lead-apollo.ts` | Novo |
| `src/features/leads/actions/backfill-apollo-source-id.ts` | Novo |
| `src/features/leads/actions/import-apollo-leads.ts` | Modificado — nome_fantasia |
| `src/features/leads/components/LeadDetailHeader.tsx` | Modificado — novo menu item |
| `src/features/leads/components/LeadDetailLayout.tsx` | Modificado — novo handler |
| `src/features/leads/index.ts` | Modificado — exports |

## Estado atual

- Branch: `main`, pushed e deployado em produção
- Working tree: limpa
- Todos os leads Apollo têm `source_id` populado
- Webhook de phone reveal funcional para todos os leads

## Pendências

- Nenhuma
