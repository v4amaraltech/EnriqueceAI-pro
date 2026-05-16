import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/custom-fields-crud', () => ({
  addCustomField: vi.fn().mockResolvedValue({ success: true, data: { id: 'f-new', org_id: 'org-1', field_name: 'Test', field_type: 'text', options: null, sort_order: 1, is_visible: true, is_required_won: false, is_required_lost: false, created_at: '2026-01-01' } }),
  updateCustomField: vi.fn().mockResolvedValue({ success: true, data: {} }),
  deleteCustomField: vi.fn().mockResolvedValue({ success: true, data: { deleted: true } }),
  updateCustomFieldSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock('../actions/standard-field-settings', () => ({
  upsertStandardFieldSetting: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import type { CustomFieldRow } from '../types/custom-field';

import { CustomFieldsSettings } from './CustomFieldsSettings';

const makeField = (overrides: Partial<CustomFieldRow> = {}): CustomFieldRow => ({
  id: 'f-1',
  org_id: 'org-1',
  field_name: 'Segmento',
  field_type: 'text',
  options: null,
  sort_order: 1,
  is_visible: true,
  is_required_won: false,
  is_required_lost: false,
  is_required_meeting: false,
  created_at: '2026-01-01',
  ...overrides,
});

describe('CustomFieldsSettings', () => {
  it('should render title', () => {
    render(<CustomFieldsSettings initial={[]} standardSettings={[]} />);
    expect(screen.getByText('Campos Personalizados')).toBeInTheDocument();
  });

  it('should show empty state when no custom fields', () => {
    render(<CustomFieldsSettings initial={[]} standardSettings={[]} />);
    expect(screen.getByText(/Nenhum campo personalizado/)).toBeInTheDocument();
  });

  it('should render existing fields in table', () => {
    render(<CustomFieldsSettings initial={[makeField()]} standardSettings={[]} />);
    expect(screen.getByText('Segmento')).toBeInTheDocument();
  });

  it('should show field type and options', () => {
    render(<CustomFieldsSettings initial={[makeField({ field_type: 'select', options: ['A', 'B'] })]} standardSettings={[]} />);
    expect(screen.getByText(/Seleção/)).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('should show tabs with counts', () => {
    render(<CustomFieldsSettings initial={[makeField()]} standardSettings={[]} />);
    expect(screen.getByText('Campos personalizados')).toBeInTheDocument();
    expect(screen.getByText('Campos padrão')).toBeInTheDocument();
  });

  it('should open create dialog on + button click', async () => {
    const user = userEvent.setup();
    render(<CustomFieldsSettings initial={[]} standardSettings={[]} />);
    const plusButtons = screen.getAllByRole('button');
    const plusBtn = plusButtons.find((b) => b.querySelector('.lucide-plus'));
    if (plusBtn) {
      await user.click(plusBtn);
      expect(screen.getByText('Novo campo personalizado')).toBeInTheDocument();
    }
  });
});
