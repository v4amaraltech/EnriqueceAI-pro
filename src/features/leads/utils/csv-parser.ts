/**
 * CSV parser for lead import.
 * Detects the CNPJ column automatically and extracts valid rows.
 */

import { isValidCnpj, stripCnpj } from './cnpj';

export interface CsvParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
  totalRows: number;
}

export interface ParsedRow {
  rowNumber: number;
  cnpj: string;
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
 * Parses a CSV string and extracts rows with valid CNPJs.
 */
export function parseCsv(content: string): CsvParseResult {
  // Strip UTF-8 BOM (﻿) — Excel and Google Sheets export it on the first
  // byte, which would otherwise contaminate the first header (e.g. "﻿cnpj")
  // and make the column-name match silently fail with "Coluna CNPJ não encontrada".
  const lines = content.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], errors: [{ rowNumber: 0, cnpj: null, errorMessage: 'Arquivo vazio ou sem dados' }], totalRows: 0 };
  }

  const headerLine = lines[0]!;
  const headers = parseRow(headerLine).map((h) => h.toLowerCase().trim());

  // Detect CNPJ column
  const cnpjIndex = headers.findIndex((h) => CNPJ_COLUMN_NAMES.includes(h));
  if (cnpjIndex === -1) {
    // Try to find column by content (first column with 14-digit values)
    const firstDataRow = lines[1] ? parseRow(lines[1]) : [];
    const detectedIndex = firstDataRow.findIndex((cell) => {
      const stripped = stripCnpj(cell);
      return stripped.length === 14 && /^\d+$/.test(stripped);
    });

    if (detectedIndex === -1) {
      return {
        rows: [],
        errors: [{ rowNumber: 0, cnpj: null, errorMessage: 'Coluna CNPJ não encontrada. Use o cabeçalho "CNPJ".' }],
        totalRows: 0,
      };
    }

    return processRows(lines, detectedIndex, headers);
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

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  // Detect optional columns
  const razaoIndex = headers.findIndex((h) => ['razao_social', 'razao social', 'razão social', 'empresa', 'company'].includes(h));
  const fantasiaIndex = headers.findIndex((h) => ['nome_fantasia', 'nome fantasia', 'fantasia', 'trade_name'].includes(h));
  const sourceIndex = headers.findIndex((h) => ['lead_source', 'origem', 'fonte', 'source'].includes(h));
  const telefoneIndex = headers.findIndex((h) => ['telefone', 'phone', 'celular', 'fone', 'whatsapp', 'tel'].includes(h));
  const emailIndex = headers.findIndex((h) => ['email', 'e-mail', 'mail'].includes(h));
  const decisorIndex = headers.findIndex((h) => ['decisor', 'contato', 'responsavel', 'responsável', 'contact_name', 'contact name', 'nome'].includes(h));
  const jobTitleIndex = headers.findIndex((h) => ['cargo', 'job_title', 'job title', 'posição', 'posicao', 'role'].includes(h));
  const websiteIndex = headers.findIndex((h) => ['website', 'site', 'url'].includes(h));
  const instagramIndex = headers.findIndex((h) => ['instagram', 'ig'].includes(h));
  const linkedinIndex = headers.findIndex((h) => ['linkedin', 'linked_in', 'linked in'].includes(h));

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i]!;
    const rowNumber = i + 2; // 1-indexed, +1 for header
    // Skip blank lines (Excel often leaves a trailing empty row that would
    // otherwise show up as "CNPJ vazio" in the import report).
    if (!line.trim()) continue;
    const cells = parseRow(line);

    const rawCnpj = cells[cnpjIndex]?.trim() ?? '';
    if (!rawCnpj) {
      errors.push({ rowNumber, cnpj: null, errorMessage: 'CNPJ vazio' });
      continue;
    }

    const cnpj = stripCnpj(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      errors.push({ rowNumber, cnpj: rawCnpj, errorMessage: 'CNPJ inválido' });
      continue;
    }

    const cellAt = (idx: number): string | undefined =>
      idx >= 0 ? cells[idx]?.trim() || undefined : undefined;

    const telefone = cellAt(telefoneIndex);
    const email = cellAt(emailIndex);
    const decisor = cellAt(decisorIndex);
    const jobTitle = cellAt(jobTitleIndex);

    rows.push({
      rowNumber,
      cnpj,
      razao_social: cellAt(razaoIndex),
      nome_fantasia: cellAt(fantasiaIndex),
      lead_source: cellAt(sourceIndex),
      telefone,
      phones: telefone ? [{ tipo: detectPhoneTipo(telefone), numero: telefone }] : undefined,
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
