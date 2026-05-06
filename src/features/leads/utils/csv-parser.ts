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

    rows.push({
      rowNumber,
      cnpj,
      razao_social: razaoIndex >= 0 ? cells[razaoIndex]?.trim() || undefined : undefined,
      nome_fantasia: fantasiaIndex >= 0 ? cells[fantasiaIndex]?.trim() || undefined : undefined,
      lead_source: sourceIndex >= 0 ? cells[sourceIndex]?.trim() || undefined : undefined,
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

export { MAX_ROWS };
