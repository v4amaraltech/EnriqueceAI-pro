/**
 * CSV parser for lead import.
 *
 * CNPJ is no longer required — a row is accepted as long as it carries some
 * identifying information (CNPJ, email, razao_social, or telefone). Rows with
 * a CNPJ still validate the checksum; rows without CNPJ rely on the import
 * action's composite dedup (CNPJ → email → razao_social+telefone).
 */

import { isValidCnpj, stripCnpj } from './cnpj';

export interface CsvParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
  totalRows: number;
}

export interface ParsedRow {
  rowNumber: number;
  /** Normalized 14-digit CNPJ, or null when the row didn't supply one. */
  cnpj: string | null;
  razao_social?: string;
  nome_fantasia?: string;
  lead_source?: string;
  /** Primary phone in legacy `telefone` column. */
  telefone?: string;
  /** Phone array (filled when CSV has telefone column). */
  phones?: Array<{ tipo: 'celular' | 'fixo' | 'whatsapp'; numero: string }>;
  /** Primary email in legacy `email` column. */
  email?: string;
  /** Email array (filled when CSV has email column). */
  emails?: Array<{ tipo: 'corporativo' | 'pessoal'; email: string }>;
  /** Decision-maker name (becomes a single-entry socios array). */
  decisor?: string;
  /** Decision-maker job title. */
  job_title?: string;
  website?: string;
  instagram?: string;
  linkedin?: string;
}

export interface ParseError {
  rowNumber: number;
  cnpj: string | null;
  errorMessage: string;
}

const MAX_ROWS = 1000;
const CNPJ_COLUMN_NAMES = ['cnpj', 'cnpj_cpf', 'documento', 'document', 'cpf_cnpj'];

/**
 * Parses a CSV string and extracts rows with at least one identifying field.
 */
export function parseCsv(content: string): CsvParseResult {
  // Strip UTF-8 BOM (﻿) — Excel and Google Sheets export it on the first
  // byte, which would otherwise contaminate the first header.
  const lines = content.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], errors: [{ rowNumber: 0, cnpj: null, errorMessage: 'Arquivo vazio ou sem dados' }], totalRows: 0 };
  }

  const headerLine = lines[0]!;
  const headers = parseRow(headerLine).map((h) => h.toLowerCase().trim());

  // Detect CNPJ column by header name first.
  let cnpjIndex = headers.findIndex((h) => CNPJ_COLUMN_NAMES.includes(h));

  // Fallback: detect by content (first column with 14-digit values) — only
  // when the header didn't already give us one.
  if (cnpjIndex === -1) {
    const firstDataRow = lines[1] ? parseRow(lines[1]) : [];
    cnpjIndex = firstDataRow.findIndex((cell) => {
      const stripped = stripCnpj(cell);
      return stripped.length === 14 && /^\d+$/.test(stripped);
    });
  }

  return processRows(lines, cnpjIndex, headers);
}

function processRows(lines: string[], cnpjIndex: number, headers: string[]): CsvParseResult {
  const dataLines = lines.slice(1);
  const totalRows = dataLines.length;

  if (totalRows > MAX_ROWS) {
    return {
      rows: [],
      errors: [{ rowNumber: 0, cnpj: null, errorMessage: `Limite de ${MAX_ROWS} linhas por importação excedido (${totalRows} linhas)` }],
      totalRows,
    };
  }

  // Column detection: header names from data brokers, CRMs, and SDR-built
  // spreadsheets vary wildly ("Nome do Decisor", "E-mail Comercial",
  // "Telefone 1", "First Name", etc). Exact match misses all of these.
  //
  // Strategy: try exact match first (fast + unambiguous), then substring
  // match against `loose`. Detection order is intentional — fantasia and
  // razao_social are detected before decisor so "Nome Fantasia" doesn't
  // get stolen by the decisor's "nome" pattern. Each `usedIndexes` set
  // prevents the same column being claimed twice.
  const usedIndexes = new Set<number>();

  function detectColumn(exact: string[], loose: string[]): number {
    for (let i = 0; i < headers.length; i++) {
      if (usedIndexes.has(i)) continue;
      if (exact.includes(headers[i]!)) {
        usedIndexes.add(i);
        return i;
      }
    }
    for (let i = 0; i < headers.length; i++) {
      if (usedIndexes.has(i)) continue;
      const h = headers[i]!;
      if (loose.some((p) => h.includes(p))) {
        usedIndexes.add(i);
        return i;
      }
    }
    return -1;
  }

  // Order matters — most specific labels first so they don't get hijacked.
  const cnpjIdx = cnpjIndex; if (cnpjIdx >= 0) usedIndexes.add(cnpjIdx);
  const fantasiaIndex = detectColumn(
    ['nome_fantasia', 'nome fantasia', 'fantasia', 'trade_name'],
    ['fantasia', 'trade_name', 'trade name'],
  );
  const razaoIndex = detectColumn(
    ['razao_social', 'razao social', 'razão social', 'empresa', 'company'],
    ['razao social', 'razão social', 'razao_social', 'company', 'empresa'],
  );
  const jobTitleIndex = detectColumn(
    ['cargo', 'job_title', 'job title', 'posição', 'posicao', 'role', 'function', 'função'],
    ['cargo', 'function', 'função', 'posição', 'posicao', 'job title', 'job_title', 'position', 'role', 'title'],
  );
  const sourceIndex = detectColumn(
    ['lead_source', 'origem', 'fonte', 'source'],
    ['lead_source', 'origem', 'fonte', 'source'],
  );
  // Apollo / Lemit exports split decisor across first_name + last_name. When
  // both exist we combine them; the per-row read picks up whichever is set.
  const firstNameIndex = detectColumn(
    ['first_name', 'first name', 'nome', 'primeiro nome', 'primeiro_nome'],
    ['first name', 'first_name', 'primeiro nome', 'primeiro_nome'],
  );
  const lastNameIndex = detectColumn(
    ['last_name', 'last name', 'sobrenome', 'ultimo nome', 'último nome'],
    ['last name', 'last_name', 'sobrenome', 'ultimo nome', 'último nome'],
  );
  // Phone columns get scored, not picked first-match. V4-enriched CSVs ship
  // four phone columns (Telefone Decisor, Telefone Fixo, Celular, Tel 2);
  // the old single-column detection grabbed "Celular" because it was an exact
  // match, leaving "Telefone Decisor" — the actually useful contact — behind.
  //
  // Detection has to run BEFORE decisor: the decisor's loose match ('decisor')
  // would otherwise hijack headers like "Telefone Decisor" or "WhatsApp do
  // Decisor" and leave the phone column hunt with only the leftovers.
  const phoneColumns = collectPhoneColumns(headers, usedIndexes);
  // Compatibility shim for the diagnostic flag below: we only care whether
  // *any* phone column was found, not which one.
  const telefoneIndex = phoneColumns.length > 0 ? phoneColumns[0]!.index : -1;
  const decisorIndex = detectColumn(
    ['decisor', 'contato', 'responsavel', 'responsável', 'contact_name', 'contact name', 'nome completo', 'full_name', 'full name'],
    ['decisor', 'responsável', 'responsavel', 'contato', 'contact', 'nome completo', 'full name', 'full_name'],
  );
  const emailIndex = detectColumn(
    ['email', 'e-mail', 'mail'],
    ['email', 'e-mail', 'e_mail'],
  );
  const websiteIndex = detectColumn(
    ['website', 'site', 'url'],
    ['website', 'site', 'url'],
  );
  const instagramIndex = detectColumn(
    ['instagram', 'ig'],
    ['instagram'],
  );
  const linkedinIndex = detectColumn(
    ['linkedin', 'linked_in', 'linked in'],
    ['linkedin'],
  );

  // File-level guard: reject when none of the identifying columns exist AND
  // we couldn't detect a CNPJ. Otherwise every row would fail with "linha
  // sem identificação" and the user gets no actionable feedback.
  const hasAnyIdColumn =
    cnpjIndex !== -1 || razaoIndex !== -1 || emailIndex !== -1 || telefoneIndex !== -1;

  if (!hasAnyIdColumn) {
    return {
      rows: [],
      errors: [{
        rowNumber: 0,
        cnpj: null,
        errorMessage: 'Nenhuma coluna identificável encontrada. Use ao menos uma de: cnpj, razao_social, email, telefone.',
      }],
      totalRows,
    };
  }

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i]!;
    const rowNumber = i + 2; // 1-indexed, +1 for header
    // Skip blank lines (Excel often leaves a trailing empty row).
    if (!line.trim()) continue;
    const cells = parseRow(line);

    const cellAt = (idx: number): string | undefined =>
      idx >= 0 ? cells[idx]?.trim() || undefined : undefined;

    // CNPJ extraction: present + valid → keep; present + invalid → row-level
    // error; absent → null (the row can still be valid if it has email/razao).
    const rawCnpj = cnpjIndex >= 0 ? (cells[cnpjIndex]?.trim() ?? '') : '';
    let cnpj: string | null = null;
    if (rawCnpj) {
      const stripped = stripCnpj(rawCnpj);
      if (!isValidCnpj(stripped)) {
        errors.push({ rowNumber, cnpj: rawCnpj, errorMessage: 'CNPJ inválido' });
        continue;
      }
      cnpj = stripped;
    }

    // Walk phone columns in score order; first non-empty cell wins as the
    // primary `telefone`. Falling back to lower-scored columns when the top
    // one is blank means a row with empty "Telefone Decisor" but a filled
    // "Celular" still ships a usable phone to the lead.
    const phoneCandidates: Array<{ col: PhoneColumn; value: string }> = [];
    for (const col of phoneColumns) {
      const v = cellAt(col.index);
      if (v) phoneCandidates.push({ col, value: v });
    }
    const telefone = phoneCandidates[0]?.value;
    // phones[] keeps every non-empty number in the row (de-duped on digits) so
    // the SDR sees the full contact set on the lead, not just the primary.
    const seenPhoneDigits = new Set<string>();
    const phonesArr: Array<{ tipo: 'celular' | 'fixo' | 'whatsapp'; numero: string }> = [];
    for (const candidate of phoneCandidates) {
      const digits = candidate.value.replace(/\D/g, '');
      if (!digits || seenPhoneDigits.has(digits)) continue;
      seenPhoneDigits.add(digits);
      phonesArr.push({
        tipo: candidate.col.tipoHint ?? detectPhoneTipo(candidate.value),
        numero: candidate.value,
      });
    }
    const email = cellAt(emailIndex);
    const jobTitle = cellAt(jobTitleIndex);
    const razaoSocial = cellAt(razaoIndex);

    // Decisor resolution: a single "Decisor"/"Nome Completo" column wins. When
    // the CSV splits the name (Apollo: First Name + Last Name), join them so
    // import-leads can run its usual first/last_name split. The fallback keeps
    // legacy single-column CSVs working unchanged.
    const rawDecisor = cellAt(decisorIndex);
    const rawFirst = cellAt(firstNameIndex);
    const rawLast = cellAt(lastNameIndex);
    const decisor =
      rawDecisor ??
      ([rawFirst, rawLast].filter(Boolean).join(' ').trim() || undefined);

    // At least one identifier is required so the row is dedupable downstream.
    if (!cnpj && !email && !razaoSocial && !telefone) {
      errors.push({ rowNumber, cnpj: null, errorMessage: 'Linha sem identificação (CNPJ, email, razão social ou telefone)' });
      continue;
    }

    rows.push({
      rowNumber,
      cnpj,
      razao_social: razaoSocial,
      nome_fantasia: cellAt(fantasiaIndex),
      lead_source: cellAt(sourceIndex),
      telefone,
      phones: phonesArr.length > 0 ? phonesArr : undefined,
      email,
      emails: email ? [{ tipo: detectEmailTipo(email), email }] : undefined,
      decisor,
      job_title: jobTitle,
      website: cellAt(websiteIndex),
      instagram: cellAt(instagramIndex),
      linkedin: cellAt(linkedinIndex),
    });
  }

  return { rows, errors, totalRows };
}

/**
 * Parses a single CSV row, handling quoted fields.
 */
function parseRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line.charAt(i + 1) === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

interface PhoneColumn {
  index: number;
  header: string;
  score: number;
  /** Forced `tipo` when the header itself names the channel (Celular, Fixo, WhatsApp); null for ambiguous headers like "Telefone Decisor". */
  tipoHint: 'celular' | 'fixo' | 'whatsapp' | null;
}

/**
 * Header keywords that mark a column as a phone column. `\b` boundaries keep
 * "telefonema"/"celularidade" out; `^tel\b|tel\s|tel\d` covers short forms
 * like "Tel", "Tel 2", "Tel2".
 */
const PHONE_HEADER_RE = /\b(telefone|celular|whatsapp|mobile|fone|phone)\b|^tel(\s|\d|$)/;

/**
 * Picks every phone-shaped column and ranks them. Higher score = more likely
 * to be the decision-maker's mobile.
 *
 *   +10 "decisor" / "contato" / "responsável" / "pessoal" / "principal"
 *   +8  "whatsapp"
 *   +5  "celular" / "mobile"
 *   -3  "fixo" / "landline"
 *   -5  "empresa" / "comercial" / "empresarial" / "recepção"
 *   -8  "tel 2", "tel2", "2", "secundário", "alternativo", "outro"
 *
 * Ties resolve by column order (left wins). Columns are marked as used so
 * downstream detectColumn calls can't reclaim them.
 */
function collectPhoneColumns(headers: string[], usedIndexes: Set<number>): PhoneColumn[] {
  const cols: PhoneColumn[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (usedIndexes.has(i)) continue;
    const h = headers[i]!;
    if (!PHONE_HEADER_RE.test(h)) continue;
    cols.push({ index: i, header: h, score: scorePhoneHeader(h), tipoHint: tipoHintFromHeader(h) });
    usedIndexes.add(i);
  }
  cols.sort((a, b) => b.score - a.score || a.index - b.index);
  return cols;
}

function scorePhoneHeader(h: string): number {
  let score = 0;
  if (/(decisor|contato|respons|pessoal|principal)/.test(h)) score += 10;
  if (/whatsapp/.test(h)) score += 8;
  if (/(celular|mobile)/.test(h)) score += 5;
  if (/(empresa|comercial|empresarial|recep)/.test(h)) score -= 5;
  if (/\bfixo\b|landline/.test(h)) score -= 3;
  if (/\btel\s*\d\b|\b(2|3)\b|(secund|alternativ|outro)/.test(h)) score -= 8;
  return score;
}

function tipoHintFromHeader(h: string): 'celular' | 'fixo' | 'whatsapp' | null {
  if (/whatsapp/.test(h)) return 'whatsapp';
  if (/(celular|mobile)/.test(h)) return 'celular';
  if (/\bfixo\b|landline/.test(h)) return 'fixo';
  return null;
}

function detectPhoneTipo(raw: string): 'celular' | 'fixo' | 'whatsapp' {
  const digits = raw.replace(/\D/g, '');
  // Brazilian mobile numbers start with 9 after the area code (10 or 11 digits total)
  // Last 9 digits start with 9 → celular; otherwise fixo.
  if (digits.length >= 10) {
    const startsWithNine = digits.length === 11
      ? digits.charAt(2) === '9'
      : digits.length === 10
        ? digits.charAt(2) === '9'
        : false;
    return startsWithNine ? 'celular' : 'fixo';
  }
  return 'fixo';
}

function detectEmailTipo(raw: string): 'corporativo' | 'pessoal' {
  const lower = raw.toLowerCase();
  const personalDomains = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br', 'live.com', 'icloud.com', 'uol.com.br', 'bol.com.br'];
  return personalDomains.some((d) => lower.endsWith('@' + d)) ? 'pessoal' : 'corporativo';
}

export { MAX_ROWS };
