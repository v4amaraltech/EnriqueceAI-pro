import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBPHONE_LIVE_AMD_FLAG_KEY, WEBPHONE_LIVE_AMD_PILOT_ORG_ID, webphoneLiveAmdEnabledFor } from './live-amd-flag';

const PILOT = WEBPHONE_LIVE_AMD_PILOT_ORG_ID;
const OTHER = '11111111-1111-1111-1111-111111111111';

describe('webphone_live_amd', () => {
  it('liga só a org do piloto enquanto enabled está false', () => {
    const row = { enabled: false, allow_org_ids: [PILOT], allow_user_ids: [] };
    expect(webphoneLiveAmdEnabledFor(row, { orgId: PILOT, userId: 'sdr-1' })).toBe(true);
    expect(webphoneLiveAmdEnabledFor(row, { orgId: OTHER, userId: 'sdr-1' })).toBe(false);
    expect(webphoneLiveAmdEnabledFor(null, { orgId: PILOT })).toBe(false);
  });

  it('enabled true ligaria todo mundo, então a migration não pode nascer assim', () => {
    expect(webphoneLiveAmdEnabledFor({ enabled: true, allow_org_ids: [PILOT] }, { orgId: OTHER })).toBe(true);
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261110230000_webphone_live_amd_flag.sql'), 'utf8');
    expect(sql).toContain(`'${WEBPHONE_LIVE_AMD_FLAG_KEY}'`);
    expect(sql).toMatch(/'webphone_live_amd',\s*false,/);
    expect(sql).toContain(PILOT);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).not.toContain('cron.schedule');
    expect(sql).not.toMatch(/UPDATE\s+public\.app_flags/i);
  });
});
