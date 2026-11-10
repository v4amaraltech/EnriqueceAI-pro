import { describe, expect, it } from 'vitest';

import type { LegacyInteraction } from './backfill';
import {
  audienceFromDirectory,
  cursorAfter,
  decideLegacyCopy,
  formatSample,
  keysetFilter,
  pageForOrg,
  parseBackfillArgs,
  readOrgPages,
  truncateBody,
} from './backfill-script';

const V4 = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SAME_TIME = '2026-08-10T18:12:00.000Z';

const row = (over: Partial<LegacyInteraction> = {}): LegacyInteraction => ({
  id: '11111111-1111-4111-8111-111111111111',
  org_id: V4,
  lead_id: '22222222-2222-4222-8222-222222222222',
  channel: 'whatsapp',
  type: 'sent',
  message_content: 'Oi Roberta, tudo bem?',
  external_id: null,
  metadata: null,
  ai_generated: false,
  performed_by: null,
  created_at: SAME_TIME,
  ...over,
});

describe('filtro da org e paginação por (created_at, id)', () => {
  const rows = [
    { id: 'a', org_id: V4, created_at: SAME_TIME },
    { id: 'b', org_id: V4, created_at: SAME_TIME },
    { id: 'c', org_id: V4, created_at: SAME_TIME },
    { id: 'd', org_id: OTHER, created_at: SAME_TIME },
    { id: 'e', org_id: V4, created_at: '2026-08-11T00:00:00.000Z' },
  ];

  it('não pula a linha que divide o mesmo created_at com a página anterior', () => {
    const page = pageForOrg(rows, V4, null, 2);
    expect(page.map((item) => item.id)).toEqual(['a', 'b']);
    const cursor = cursorAfter(page);
    expect(cursor).toEqual({ createdAt: SAME_TIME, id: 'b' });

    const next = pageForOrg(rows, V4, cursor, 2);
    expect(next.map((item) => item.id)).toEqual(['c', 'e']);
    const skippedByCreatedAtOnly = rows.filter((item) => item.org_id === V4 && item.created_at > SAME_TIME);
    expect(skippedByCreatedAtOnly.map((item) => item.id)).toEqual(['e']);

    expect(keysetFilter(cursor!)).toContain('created_at.gt.');
    expect(keysetFilter(cursor!)).toContain('created_at.eq.');
    expect(keysetFilter(cursor!)).toContain('id.gt.');
  });

  it('só devolve a org pedida, uma vez, inclusive na borda do timestamp', () => {
    const seen = readOrgPages(rows, V4, 2);
    expect(seen.map((item) => item.id)).toEqual(['a', 'b', 'c', 'e']);
    expect(seen.some((item) => item.org_id !== V4)).toBe(false);
    expect(readOrgPages(rows, OTHER, 2).map((item) => item.id)).toEqual(['d']);
  });

  it('exige --org e não grava sem --execute', () => {
    expect(parseBackfillArgs(['--org', V4])).toEqual({ orgId: V4, execute: false });
    expect(parseBackfillArgs(['--org', V4, '--dry-run']).execute).toBe(false);
    expect(parseBackfillArgs(['--execute', `--org=${V4}`])).toEqual({ orgId: V4, execute: true });
    expect(() => parseBackfillArgs(['--execute'])).toThrow(/--org/);
    expect(() => parseBackfillArgs(['--org', 'v4'])).toThrow(/--org/);
    expect(() => parseBackfillArgs(['--org', V4, '--execute', '--dry-run'])).toThrow(/um modo/);
  });
});

describe('o que o backfill copia ou ignora', () => {
  const lead = audienceFromDirectory({
    telefone: '11988887777',
    phones: null,
    email: 'lead@acme.com',
    emails: null,
    contacts: [{ phones: [{ numero: '11977776666' }], emails: [{ email: 'outro@acme.com' }] }],
  });

  it('separa aviso interno, vazio, telefone do lead e destino de outra pessoa', () => {
    expect(decideLegacyCopy(row(), lead)).toMatchObject({ copy: { body_text: 'Oi Roberta, tudo bem?' } });
    const sameLead = decideLegacyCopy(row({
      metadata: { recipient: '5511988887777' },
    }), lead);
    expect('copy' in sameLead && sameLead.copy.provider_message_id).toBe(`interaction:${row().id}`);

    expect(decideLegacyCopy(row({
      message_content: 'WhatsApp de solicitação de feedback enviado para Vinicius Mercante',
      metadata: { source: 'closer_feedback', recipient_kind: 'closer', recipient: '11945705316' },
    }), lead)).toEqual({ skip: 'aviso interno' });

    expect(decideLegacyCopy(row({
      message_content: null,
      metadata: { error: 'not_whatsapp' },
      type: 'failed',
    }), lead)).toEqual({ skip: 'vazio' });

    expect(decideLegacyCopy(row({
      metadata: { system_event: 'step_skipped_auto', skip_reason: 'no_phone' },
      message_content: 'Lead sem telefone',
    }), lead)).toEqual({ skip: 'sem telefone do lead' });

    expect(decideLegacyCopy(row({
      metadata: { recipient: '11945705316' },
    }), lead)).toEqual({ skip: 'destino não é do lead' });

    const noPhone = audienceFromDirectory({ telefone: null, contacts: [] });
    expect(decideLegacyCopy(row({ metadata: { recipient: '11945705316' } }), noPhone)).toEqual({
      skip: 'sem telefone do lead',
    });
    const kept = decideLegacyCopy(row(), noPhone);
    expect('copy' in kept && kept.copy.body_text).toBe('Oi Roberta, tudo bem?');
  });

  it('amostra o corpo em 60 caracteres e mascara telefone e e-mail', () => {
    const long = `Oi, meu contato é 11988887777 e lead@acme.com. ${'x'.repeat(80)}`;
    const sample = formatSample(row({
      message_content: long,
      metadata: { recipient: '11988887777', to: 'lead@acme.com' },
    }), {
      org_id: V4,
      lead_id: row().lead_id,
      channel: 'whatsapp',
      direction: 'outbound',
      provider: 'legacy_interactions',
      body_text: long,
      body_html: null,
      subject: null,
      provider_message_id: 'interaction:1',
      thread_id: null,
      sent_by: null,
      ai_generated: false,
      occurred_at: SAME_TIME,
      status: 'sent',
    });
    const body = sample.slice(sample.indexOf('"') + 1, sample.lastIndexOf('"'));
    expect(body.length).toBeLessThanOrEqual(60);
    expect(truncateBody('a'.repeat(80)).length).toBe(60);
    expect(sample).not.toContain('11988887777');
    expect(sample).not.toContain('lead@acme.com');
    expect(sample).toContain('***@***');
    expect(sample).toContain('dest=');
  });
});
