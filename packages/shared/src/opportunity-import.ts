/**
 * The bulk-import contract for opportunities.
 *
 * One declaration, shared by the template the user downloads, the parser that
 * reads what they send back, and the screen that documents the columns. Three
 * copies of a column list drift within a release: someone adds a field to the
 * parser, the template still omits it, and the only symptom is a column that
 * silently does nothing.
 *
 * Header keys are English and stable on purpose. They are an interface, not
 * prose: translating them would mean a file exported in Arabic could not be
 * re-imported by a French colleague, and a renamed heading would break every
 * spreadsheet already saved on somebody's laptop. The human-readable labels
 * live in the UI, beside the column, where they can be translated freely.
 */
export interface ImportColumn {
  key: string;
  required: boolean;
  kind: 'text' | 'number' | 'date' | 'code';
  /** For 'code' columns: which controlled vocabulary the value must belong to. */
  list?: string;
}

export const OPPORTUNITY_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'name', required: true, kind: 'text' },
  // Matched on the customer's code first and legal name second. A code is
  // unambiguous; a name is what people actually have to hand.
  { key: 'accountCode', required: true, kind: 'text' },
  { key: 'country', required: true, kind: 'code', list: 'COUNTRY' },

  // The four independent readings, each its own column. Collapsing them into
  // one "status" column would be the one thing this system refuses to do
  // everywhere else, and an import is not a licence to do it here.
  { key: 'stage', required: false, kind: 'code' },
  { key: 'status', required: false, kind: 'code' },
  { key: 'forecastCategory', required: false, kind: 'code' },
  { key: 'health', required: false, kind: 'code' },

  { key: 'currency', required: false, kind: 'code', list: 'CURRENCY' },
  { key: 'estimatedValue', required: false, kind: 'number' },

  // Who sent it, when it came, when it should close, what happens next — the
  // four questions a pipeline row is asked in every review.
  { key: 'contactName', required: false, kind: 'text' },
  { key: 'contactEmail', required: false, kind: 'text' },
  { key: 'receivedDate', required: false, kind: 'date' },
  { key: 'expectedCloseDate', required: false, kind: 'date' },
  { key: 'nextStep', required: false, kind: 'text' },

  { key: 'source', required: false, kind: 'code', list: 'LEAD_SOURCE' },
  { key: 'industry', required: false, kind: 'code', list: 'INDUSTRY' },
  { key: 'ownerEmail', required: false, kind: 'text' },
  { key: 'description', required: false, kind: 'text' },
];

export const OPPORTUNITY_IMPORT_HEADERS: readonly string[] =
  OPPORTUNITY_IMPORT_COLUMNS.map((c) => c.key);

/** Ceiling on one file. Past this the request, not the data, becomes the problem. */
export const OPPORTUNITY_IMPORT_MAX_ROWS = 500;

export interface ImportRowError {
  /** 1-based row number as the spreadsheet shows it, header row included. */
  line: number;
  column: string | null;
  message: string;
}

export interface ImportPreviewRow {
  line: number;
  name: string;
  accountLabel: string | null;
  stage: string;
  /** A contact this row will bring into being rather than merely reference. */
  createsContact: string | null;
  errors: ImportRowError[];
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  rows: ImportPreviewRow[];
  /** Problems with the file itself — a missing column, an unreadable header. */
  fileErrors: string[];
}
