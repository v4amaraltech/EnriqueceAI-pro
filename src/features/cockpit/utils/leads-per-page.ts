/** Tamanhos de página aceitos na tabela "Meus Leads" (limite do `fetchLeads` é 100). */
export const LEADS_PER_PAGE_OPTIONS = [25, 50, 100] as const;
export const LEADS_PER_PAGE_DEFAULT = 25;

/** Lê `?per_page=`; qualquer valor fora das opções cai no padrão. */
export function parseLeadsPerPage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  return (LEADS_PER_PAGE_OPTIONS as readonly number[]).includes(n) ? n : LEADS_PER_PAGE_DEFAULT;
}
