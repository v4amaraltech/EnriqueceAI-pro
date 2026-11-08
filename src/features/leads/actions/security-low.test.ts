import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../services/meeting-briefing-format';

const read = (f: string) => readFileSync(join(process.cwd(), 'src/features/leads', f), 'utf8');

describe('pista 12', () => {
  it('sendCloserFeedbackEmail não é Server Action', () => {
    expect(read('actions/send-closer-feedback.ts')).not.toMatch(/^['"]use server['"]/m);
  });

  it('o HTML do e-mail escapa closerName e leadName', () => {
    const src = read('services/closer-feedback-delivery.service.ts');
    expect(src).toContain('${escapeHtml(closerName)}');
    expect(src).toContain('${escapeHtml(leadName)}');
    expect(escapeHtml('<img onerror=x>')).toBe('&lt;img onerror=x&gt;');
  });
});

describe('pista 28', () => {
  it.each(['create-lead', 'import-leads', 'import-apollo-leads'])('%s conta leads via countOrgLeads', (f) => {
    const src = read(`actions/${f}.ts`);
    expect(src).toContain('countOrgLeads(orgId)');
  });
});
