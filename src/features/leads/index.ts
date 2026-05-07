// Leads feature barrel export

// Types
export type {
  LeadRow,
  LeadImportRow,
  LeadImportErrorRow,
  EnrichmentAttemptRow,
  LeadStatus,
  EnrichmentStatus,
  ImportStatus,
  EnrichmentProvider,
  LeadAddress,
  LeadSocio,
  LeadInsert,
  LeadImportInsert,
  LeadImportErrorInsert,
} from './types';

// Contract
export type { LeadListResult, ImportResult } from './leads.contract';

// Schemas
export {
  cnpjSchema,
  createLeadSchema,
  leadFiltersSchema,
  leadStatusSchema,
  enrichmentStatusSchema,
  leadStatusValues,
  enrichmentStatusValues,
  LEAD_SOURCE_OPTIONS,
  leadSourceValues,
} from './schemas/lead.schemas';
export type { CreateLeadInput, LeadFilters } from './schemas/lead.schemas';

// Utils
export { isValidCnpj, formatCnpj, stripCnpj } from './utils/cnpj';
export { parseCsv } from './utils/csv-parser';
export type { CsvParseResult, ParsedRow, ParseError } from './utils/csv-parser';

// Actions
export { importLeads } from './actions/import-leads';
export type { ImportLeadsResult } from './actions/import-leads';
export { enrichLeadWithApollo } from './actions/enrich-lead-apollo';
export { backfillApolloSourceIds } from './actions/backfill-apollo-source-id';
export { fetchLeads } from './actions/fetch-leads';
export { fetchLead } from './actions/fetch-lead';
export { bulkDeleteLeads, bulkArchiveLeads, exportLeadsCsv } from './actions/bulk-actions';
export { fetchUserMap } from './actions/fetch-user-map';
export { archiveLead } from './actions/lead-lifecycle';
export { updateLead } from './actions/update-lead';

// Components
export { ImportView } from './components/ImportView';
export { LeadListView } from './components/LeadListView';
export { LeadTable } from './components/LeadTable';
export { LeadPagination } from './components/LeadPagination';
export { LeadStatusBadge, EnrichmentStatusBadge } from './components/LeadStatusBadge';
export { LeadDetailLayout } from './components/LeadDetailLayout';
