export interface CsvRow {
  rowNumber: number;
  values: string[];
}

export type CsvParseResult =
  | { ok: true; headers: string[]; rows: CsvRow[] }
  | { ok: false; message: string; rowNumber?: number };

/**
 * Minimal RFC 4180 parser for payroll registers.
 *
 * Supports UTF-8 BOM prefixes, CRLF/LF row endings, quoted fields with escaped
 * double quotes, and delimiters or newlines inside quoted fields. Blank lines
 * are skipped. This intentionally does not accept a configurable delimiter:
 * the documented payroll format is always comma-separated.
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;

  const pushRecord = () => {
    record.push(field);
    const blank = record.length === 1 && record[0] === '';
    if (!blank) {
      records.push(record);
    }
    record = [];
    field = '';
    fieldStart = true;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          fieldStart = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      continue;
    }

    if (char === ',') {
      record.push(field);
      field = '';
      fieldStart = true;
      continue;
    }

    if (char === '\n') {
      pushRecord();
      continue;
    }

    if (char === '\r') {
      if (text[i + 1] === '\n') {
        i += 1;
      }
      pushRecord();
      continue;
    }

    field += char;
    fieldStart = false;
  }

  if (inQuotes) {
    return {
      ok: false,
      message: 'Unclosed quoted field in CSV input',
      rowNumber: Math.max(1, records.length),
    };
  }

  if (field !== '' || record.length > 0) {
    pushRecord();
  }

  const [headers = [], ...rows] = records;

  return {
    ok: true,
    headers,
    rows: rows.map((values, index) => ({ rowNumber: index + 1, values })),
  };
}
