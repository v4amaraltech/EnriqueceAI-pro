// Templates feature re-exports from cadences
// Message templates are closely tied to cadences but have their own route
export type {
  ChannelType,
  MessageTemplateRow,
  MessageTemplateInsert,
} from '../cadences/types';

export type {
  TemplateListResult,
} from '../cadences/cadences.contract';

export {
  createTemplateSchema,
  updateTemplateSchema,
  templateFiltersSchema,
  channelTypeSchema,
  TEMPLATE_VARIABLE_REGEX,
  AVAILABLE_TEMPLATE_VARIABLES,
  VENDOR_TEMPLATE_VARIABLES,
  ALL_TEMPLATE_VARIABLES,
} from '../cadences/cadence.schemas';

export type {
  CreateTemplate,
  UpdateTemplate,
  TemplateFilters,
  TemplateVariable,
} from '../cadences/cadence.schemas';

export { extractVariables, renderTemplate } from '../cadences/utils/render-template';
