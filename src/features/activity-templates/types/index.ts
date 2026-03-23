import type { ChannelType } from '@/features/cadences/types';

export interface ActivityTemplateRow {
  id: string;
  org_id: string;
  name: string;
  channel: ChannelType;
  instructions: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
