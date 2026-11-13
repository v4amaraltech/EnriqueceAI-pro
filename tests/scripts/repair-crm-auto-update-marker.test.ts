import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../scripts/repair-crm-auto-update-marker';

const ID = '9f038ff7-0000-4000-8000-000000000002';

describe('script de reparo (dry-run)', () => {
  it('recusa --apply', () => {
    expect(() => parseArgs(['--call', ID, '--apply'])).toThrow(/dry-run/);
  });

  it('exige UUID completo', () => {
    expect(() => parseArgs(['--call', '9f038ff7'])).toThrow(/UUID completo/);
    expect(() => parseArgs([])).toThrow(/--call/);
    expect(parseArgs(['--call', ID])).toEqual({ callIds: [ID] });
  });
});
