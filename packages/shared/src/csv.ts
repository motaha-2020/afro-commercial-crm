/**
 * A CSV reader and writer, written out rather than pulled in.
 *
 * The project has no spreadsheet dependency and this is not enough reason to
 * acquire one: the format's whole grammar is quoting, and it fits below. What
 * it does handle is what Excel actually emits — quoted fields containing
 * commas, embedded newlines, and "" for a literal quote — because a customer
 * name with a comma in it is not an edge case, it is Tuesday.
 */

/** Excel writes CRLF; a file edited on a Mac may not. Both read the same here. */
export function parseCsv(input: string): string[][] {
  // A leading byte-order mark would otherwise become part of the first header,
  // so column "name" would arrive as "﻿name" and match nothing.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Swallow CRLF as one line break rather than producing an empty row.
      if (text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // A file that does not end in a newline still has a last row.
  if (field.length > 0 || row.length > 0) endRow();

  // Excel pads short files with fully blank lines; they are not data.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The BOM is not decoration. Without it Excel on Windows reads a UTF-8 file in
 * the system codepage, and every Arabic heading arrives as mojibake — which
 * looks like a broken export rather than a misread one.
 */
export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
