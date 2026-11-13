import { resolveLeadMessageBodyText } from './body-text';

/**
 * Preenche lead_messages.body_text vazio a partir de body_html, de UMA org.
 * Lógica pura: o acesso ao banco entra por FillBodyTextDb (script em scripts/,
 * mock nos testes). O padrão é dry-run. Nunca imprime corpo de mensagem.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FILL_PAGE = 200;

export interface FillBodyTextArgs {
  orgId: string;
  apply: boolean;
}

export interface FillCandidateRow {
  id: string;
  org_id: string;
  channel: 'whatsapp' | 'email';
  direction: 'inbound' | 'outbound';
  provider: string;
  body_text: string | null;
  body_html: string | null;
  created_at: string;
}

export interface FillCursor {
  createdAt: string;
  id: string;
}

export interface FillBodyTextDb {
  /** Linhas da org com body_html não vazio e body_text nulo ou vazio, em ordem (created_at, id). */
  listCandidates(orgId: string, after: FillCursor | null, limit: number): Promise<FillCandidateRow[]>;
  /** UPDATE só de body_text, só se ainda estiver vazio. Devolve true quando gravou. */
  updateBodyText(orgId: string, id: string, bodyText: string): Promise<boolean>;
}

export interface FillGroupTally {
  candidates: number;
  fillable: number;
  stillEmpty: number;
  updated: number;
}

export interface FillReport {
  apply: boolean;
  total: FillGroupTally;
  groups: Record<string, FillGroupTally>;
  stillEmptyIds: string[];
}

/** --org é obrigatório. Sem --apply é dry-run. --apply com --dry-run é erro. */
export function parseFillBodyTextArgs(argv: string[]): FillBodyTextArgs {
  let orgId = '';
  let apply = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--org') {
      orgId = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--org=')) {
      orgId = arg.slice('--org='.length);
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (apply && dryRun) throw new Error('Use só um modo: --dry-run ou --apply.');
  if (!UUID.test(orgId)) {
    throw new Error('Informe --org com o uuid da organização. Sem isso o script não lê nada.');
  }
  return { orgId, apply };
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Candidata: HTML com conteúdo e texto nulo ou só espaço. */
export function isFillCandidate(row: Pick<FillCandidateRow, 'body_text' | 'body_html'>): boolean {
  return hasText(row.body_html) && !hasText(row.body_text);
}

export function groupKey(row: Pick<FillCandidateRow, 'channel' | 'direction' | 'provider'>): string {
  return `${row.channel}/${row.direction}/${row.provider}`;
}

function emptyTally(): FillGroupTally {
  return { candidates: 0, fillable: 0, stillEmpty: 0, updated: 0 };
}

/** Texto que o script gravaria, ou null se a conversão não deixa texto. */
export function fillTextFor(row: FillCandidateRow): string | null {
  return resolveLeadMessageBodyText({
    bodyText: null,
    bodyHtml: row.body_html,
    channel: row.channel,
    direction: row.direction,
  });
}

export async function runFillBodyText(options: {
  argv: string[];
  db: FillBodyTextDb;
  log?: (line: string) => void;
  pageSize?: number;
}): Promise<FillReport> {
  const args = parseFillBodyTextArgs(options.argv);
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pageSize = options.pageSize ?? FILL_PAGE;
  const report: FillReport = { apply: args.apply, total: emptyTally(), groups: {}, stillEmptyIds: [] };
  let cursor: FillCursor | null = null;

  for (;;) {
    const rows = await options.db.listCandidates(args.orgId, cursor, pageSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.org_id !== args.orgId) {
        throw new Error('A página trouxe outra org. O script parou.');
      }
      if (!isFillCandidate(row)) continue;
      const key = groupKey(row);
      const group = report.groups[key] ?? emptyTally();
      report.groups[key] = group;
      group.candidates += 1;
      report.total.candidates += 1;
      const text = fillTextFor(row);
      if (!text) {
        group.stillEmpty += 1;
        report.total.stillEmpty += 1;
        report.stillEmptyIds.push(row.id);
        continue;
      }
      group.fillable += 1;
      report.total.fillable += 1;
      if (!args.apply) continue;
      if (await options.db.updateBodyText(args.orgId, row.id, text)) {
        group.updated += 1;
        report.total.updated += 1;
      }
    }
    const last = rows[rows.length - 1];
    if (!last || rows.length < pageSize) break;
    cursor = { createdAt: last.created_at, id: last.id };
  }

  printFillReport(log, report);
  return report;
}

/** Só ids e contagens. Nenhum corpo de mensagem. */
export function printFillReport(log: (line: string) => void, report: FillReport): void {
  log(`Modo: ${report.apply ? 'apply' : 'dry-run'}. Só a org pedida foi consultada.`);
  log(`Total  candidatas: ${report.total.candidates}  preenchíveis: ${report.total.fillable}  ainda vazias: ${report.total.stillEmpty}${report.apply ? `  gravadas: ${report.total.updated}` : ''}`);
  for (const key of Object.keys(report.groups).sort()) {
    const group = report.groups[key];
    if (!group) continue;
    log(`  ${key}  candidatas: ${group.candidates}  preenchíveis: ${group.fillable}  ainda vazias: ${group.stillEmpty}${report.apply ? `  gravadas: ${group.updated}` : ''}`);
  }
  if (report.stillEmptyIds.length > 0) {
    log(`Ainda vazias depois da conversão (ids): ${report.stillEmptyIds.slice(0, 50).join(', ')}`);
  }
  if (!report.apply) log('Dry-run: nenhuma escrita.');
}
