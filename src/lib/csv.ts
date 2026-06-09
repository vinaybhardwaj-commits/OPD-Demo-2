/**
 * Minimal RFC-4180 CSV parser.
 *
 * Handles:
 *  - quoted fields with embedded commas, newlines, and doubled `""` quotes
 *  - LF and CRLF line endings
 *  - trailing blank lines (skipped)
 *
 * Not handled (and not needed for the formulary import):
 *  - per-column type coercion (we keep everything as string)
 *  - configurable delimiters
 *
 * We avoid pulling in `csv-parse` or `papaparse` for one job. ~60 lines is
 * cheaper than a dep.
 */

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const records = parseRecords(text);
  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim());
  return records.slice(1).map((cells) => {
    const row: CsvRow = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cells[i] ?? '').trim();
    }
    return row;
  });
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      row.push(field);
      // Skip empty rows
      if (!(row.length === 1 && row[0] === '')) records.push(row);
      row = [];
      field = '';
      // Eat \r\n as one line break
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) records.push(row);
  }

  return records;
}
