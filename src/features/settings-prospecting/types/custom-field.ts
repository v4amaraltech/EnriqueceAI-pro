export interface CustomFieldRow {
  id: string;
  org_id: string;
  field_name: string;
  field_type: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime' | 'select' | 'url';
  options: string[] | null;
  sort_order: number;
  is_visible: boolean;
  is_required_won: boolean;
  is_required_lost: boolean;
  is_required_meeting: boolean;
  created_at: string;
}
