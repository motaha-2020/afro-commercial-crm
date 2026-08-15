import { CONTACT_INFLUENCE_LEVELS, CONTACT_ROLES } from './crm';
import {
  FORECAST_CATEGORIES,
  HEALTH_STATES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
} from './opportunity';
import { RESPONSIBILITIES, SCOPE_CATEGORIES, SCOPE_INCLUSIONS } from './scope';

/**
 * The bulk-import contract, declared once for every importable thing.
 *
 * One registry rather than one importer per entity. The first version of this
 * was written for opportunities alone, and copying it seven times would have
 * meant seven places to fix the next date-parsing bug and seven templates free
 * to drift from the parsers that read them. What differs between entities is
 * their columns, their parent, and the handful of rules only they can enforce;
 * everything else — quoting, headers, required fields, reference codes, dates,
 * numbers, duplicate detection, preview, all-or-nothing commit — is the same
 * problem each time and is solved once in the engine.
 *
 * Header keys stay English and stable. They are an interface, not prose: a file
 * exported by an Arabic user has to re-import for a French one, and a renamed
 * heading breaks every spreadsheet already saved on somebody's laptop. Labels
 * are translated on screen, next to the column.
 */
export interface ImportColumn {
  key: string;
  required: boolean;
  kind: 'text' | 'number' | 'date' | 'code' | 'boolean' | 'codes';
  /** For 'code'/'codes': the administered list the value must belong to. */
  list?: string;
  /** For 'code'/'codes': a fixed vocabulary compiled into the app. */
  allowed?: readonly string[];
  /** Applied when the cell is blank. */
  fallback?: string;
}

/**
 * What a row must be attached to before it can exist.
 *
 * `none` — the record stands alone (a customer, a lead).
 * `row` — the parent is named per row, in a column (a contact's customer).
 * `context` — one parent for the whole file, chosen on screen before upload.
 *   A scope item belongs to a package; asking for the package once is both
 *   less typing and less opportunity to spread one breakdown over two parents
 *   by mistake.
 */
export type ImportScope = 'none' | 'row' | 'context';

export interface ImportDefinition {
  resource: string;
  scope: ImportScope;
  /** Which record the context id refers to, for `scope: 'context'`. */
  contextType?: 'scopePackage' | 'costingPackage' | 'opportunity';
  /**
   * Rows may name another row in the same file as their parent, via ref /
   * parentRef. A breakdown is a tree, and a flat file can only express one by
   * letting a line point at a line above it.
   */
  tree: boolean;
  /** Column whose repetition inside one file is almost always a paste error. */
  uniqueBy?: string;
  columns: readonly ImportColumn[];
}

const OWNER: ImportColumn = { key: 'ownerEmail', required: false, kind: 'text' };
const TREE_COLUMNS: readonly ImportColumn[] = [
  // A handle for this row, meaningful only inside this file. Any short label
  // will do — "1", "1.1", "civil" — because nothing outside the file reads it.
  { key: 'ref', required: false, kind: 'text' },
  { key: 'parentRef', required: false, kind: 'text' },
];

export const IMPORT_DEFINITIONS: Record<string, ImportDefinition> = {
  accounts: {
    resource: 'accounts',
    scope: 'none',
    tree: false,
    uniqueBy: 'legalName',
    columns: [
      { key: 'legalName', required: true, kind: 'text' },
      { key: 'type', required: true, kind: 'code', list: 'ACCOUNT_TYPE' },
      { key: 'country', required: true, kind: 'code', list: 'COUNTRY' },
      { key: 'tradeName', required: false, kind: 'text' },
      { key: 'industry', required: false, kind: 'code', list: 'INDUSTRY' },
      { key: 'city', required: false, kind: 'text' },
      { key: 'address', required: false, kind: 'text' },
      { key: 'website', required: false, kind: 'text' },
      { key: 'taxId', required: false, kind: 'text' },
      { key: 'paymentTermDays', required: false, kind: 'number' },
      // The parent company, by its code or legal name. It may be a company
      // created earlier in this same file — a group and its subsidiaries
      // usually arrive together.
      { key: 'parentAccountCode', required: false, kind: 'text' },
      OWNER,
      // creditStatus is deliberately absent. Segregation of duties rule 5 says
      // whoever creates the customer does not set its credit standing, and a
      // spreadsheet is not an exemption from that — it is the easiest way to
      // set four hundred of them at once.
    ],
  },

  contacts: {
    resource: 'contacts',
    scope: 'row',
    tree: false,
    columns: [
      { key: 'accountCode', required: true, kind: 'text' },
      { key: 'fullName', required: true, kind: 'text' },
      { key: 'jobTitle', required: false, kind: 'text' },
      { key: 'email', required: false, kind: 'text' },
      { key: 'phone', required: false, kind: 'text' },
      { key: 'mobile', required: false, kind: 'text' },
      {
        key: 'influence',
        required: false,
        kind: 'code',
        allowed: CONTACT_INFLUENCE_LEVELS,
      },
      { key: 'isPrimary', required: false, kind: 'boolean' },
      // Roles are rows, not a column, so several are allowed in one cell —
      // the same person is often both the technical and the commercial
      // evaluator, and forcing a choice loses what the bid team needs.
      { key: 'roles', required: false, kind: 'codes', allowed: CONTACT_ROLES },
      { key: 'notes', required: false, kind: 'text' },
    ],
  },

  leads: {
    resource: 'leads',
    scope: 'none',
    tree: false,
    uniqueBy: 'name',
    columns: [
      { key: 'name', required: true, kind: 'text' },
      { key: 'source', required: true, kind: 'code', list: 'LEAD_SOURCE' },
      { key: 'country', required: true, kind: 'code', list: 'COUNTRY' },
      { key: 'industry', required: false, kind: 'code', list: 'INDUSTRY' },
      { key: 'estimatedValue', required: false, kind: 'number' },
      { key: 'currency', required: false, kind: 'code', list: 'CURRENCY' },
      // An enquiry may arrive before the company behind it is known, so the
      // customer is optional here in a way it is not for an opportunity.
      { key: 'accountCode', required: false, kind: 'text' },
      { key: 'contactEmail', required: false, kind: 'text' },
      { key: 'nextStep', required: false, kind: 'text' },
      { key: 'description', required: false, kind: 'text' },
      OWNER,
      // status is absent: every imported lead is NEW. A lead imported as
      // CONVERTED would claim an opportunity that does not exist, and one
      // imported as DISQUALIFIED would carry no written reason — which is the
      // only thing ever asked about a dead enquiry.
    ],
  },

  partners: {
    resource: 'partners',
    scope: 'none',
    tree: false,
    uniqueBy: 'legalName',
    columns: [
      { key: 'legalName', required: true, kind: 'text' },
      { key: 'country', required: true, kind: 'code', list: 'COUNTRY' },
      { key: 'types', required: false, kind: 'codes', list: 'PARTNER_TYPE' },
      { key: 'tradeName', required: false, kind: 'text' },
      { key: 'city', required: false, kind: 'text' },
      { key: 'address', required: false, kind: 'text' },
      { key: 'taxNumber', required: false, kind: 'text' },
      { key: 'website', required: false, kind: 'text' },
      { key: 'contactName', required: false, kind: 'text' },
      { key: 'contactEmail', required: false, kind: 'text' },
      { key: 'contactPhone', required: false, kind: 'text' },
      { key: 'notes', required: false, kind: 'text' },
      OWNER,
      // approvalStatus and blacklisting are absent for the same reason they are
      // absent from the edit form: they belong to procurement and finance, and
      // every imported partner starts a prospect.
    ],
  },

  opportunities: {
    resource: 'opportunities',
    scope: 'none',
    tree: false,
    uniqueBy: 'name',
    columns: [
      { key: 'name', required: true, kind: 'text' },
      { key: 'accountCode', required: true, kind: 'text' },
      { key: 'country', required: true, kind: 'code', list: 'COUNTRY' },
      // The four independent readings, each its own column. Collapsing them
      // into one "status" is the thing this system refuses everywhere else.
      {
        key: 'stage',
        required: false,
        kind: 'code',
        allowed: OPPORTUNITY_STAGES,
        fallback: 'LEAD_INTAKE',
      },
      {
        key: 'status',
        required: false,
        kind: 'code',
        allowed: OPPORTUNITY_STATUSES,
        fallback: 'ACTIVE',
      },
      {
        key: 'forecastCategory',
        required: false,
        kind: 'code',
        allowed: FORECAST_CATEGORIES,
        fallback: 'PIPELINE',
      },
      {
        key: 'health',
        required: false,
        kind: 'code',
        allowed: HEALTH_STATES,
        fallback: 'GREEN',
      },
      { key: 'currency', required: false, kind: 'code', list: 'CURRENCY' },
      { key: 'estimatedValue', required: false, kind: 'number' },
      { key: 'contactName', required: false, kind: 'text' },
      { key: 'contactEmail', required: false, kind: 'text' },
      { key: 'receivedDate', required: false, kind: 'date' },
      { key: 'expectedCloseDate', required: false, kind: 'date' },
      { key: 'nextStep', required: false, kind: 'text' },
      { key: 'source', required: false, kind: 'code', list: 'LEAD_SOURCE' },
      { key: 'industry', required: false, kind: 'code', list: 'INDUSTRY' },
      OWNER,
      { key: 'description', required: false, kind: 'text' },
    ],
  },

  'scope-packages': {
    resource: 'scope-packages',
    scope: 'context',
    contextType: 'opportunity',
    tree: false,
    uniqueBy: 'name',
    columns: [
      { key: 'name', required: true, kind: 'text' },
      { key: 'category', required: false, kind: 'code', allowed: SCOPE_CATEGORIES },
      {
        key: 'inclusion',
        required: false,
        kind: 'code',
        allowed: SCOPE_INCLUSIONS,
        fallback: 'INCLUDED',
      },
      { key: 'description', required: false, kind: 'text' },
      { key: 'responsibleTeam', required: false, kind: 'text' },
      { key: 'sortOrder', required: false, kind: 'number' },
    ],
  },

  'scope-items': {
    resource: 'scope-items',
    scope: 'context',
    contextType: 'scopePackage',
    tree: true,
    columns: [
      ...TREE_COLUMNS,
      { key: 'name', required: true, kind: 'text' },
      { key: 'quantity', required: false, kind: 'number' },
      { key: 'unit', required: false, kind: 'text' },
      {
        key: 'responsibility',
        required: false,
        kind: 'code',
        allowed: RESPONSIBILITIES,
        fallback: 'AFRO',
      },
      { key: 'description', required: false, kind: 'text' },
      { key: 'location', required: false, kind: 'text' },
      { key: 'technicalSpecification', required: false, kind: 'text' },
      { key: 'customerResponsibility', required: false, kind: 'text' },
      { key: 'afroResponsibility', required: false, kind: 'text' },
      { key: 'exclusion', required: false, kind: 'text' },
      { key: 'acceptanceCriteria', required: false, kind: 'text' },
      { key: 'sortOrder', required: false, kind: 'number' },
    ],
  },

  'boq-items': {
    resource: 'boq-items',
    scope: 'context',
    contextType: 'costingPackage',
    tree: true,
    columns: [
      ...TREE_COLUMNS,
      { key: 'itemNumber', required: false, kind: 'text' },
      { key: 'description', required: true, kind: 'text' },
      { key: 'quantity', required: true, kind: 'number' },
      { key: 'unit', required: false, kind: 'text' },
      { key: 'technicalDescription', required: false, kind: 'text' },
      { key: 'customerRate', required: false, kind: 'number' },
      { key: 'sellingRate', required: false, kind: 'number' },
      // targetMarginPercent is deliberately not a column. Margin is profit over
      // selling price, derived from the line's COST — and a line that has just
      // been imported has no cost breakdown yet, so a margin here would resolve
      // against zero and price everything at zero. The margin is set on the
      // package once its costs exist. Offering the column would be offering a
      // number that quietly means nothing.
      { key: 'sortOrder', required: false, kind: 'number' },
    ],
  },
};

export const IMPORT_RESOURCES = Object.keys(IMPORT_DEFINITIONS);

export function importDefinition(resource: string): ImportDefinition | undefined {
  return IMPORT_DEFINITIONS[resource];
}

export function importHeaders(resource: string): string[] {
  return (IMPORT_DEFINITIONS[resource]?.columns ?? []).map((c) => c.key);
}

/** Ceiling on one file. Past this the request, not the data, is the problem. */
export const IMPORT_MAX_ROWS = 500;

export interface ImportRowError {
  /** 1-based row number as the spreadsheet shows it, header row included. */
  line: number;
  column: string | null;
  message: string;
}

export interface ImportPreviewRow {
  line: number;
  label: string;
  /** The parent this row will attach to, named for the reader. */
  parentLabel: string | null;
  /** A record this row will bring into being rather than merely reference. */
  createsLabel: string | null;
  errors: ImportRowError[];
}

export interface ImportPreview {
  resource: string;
  totalRows: number;
  validRows: number;
  rows: ImportPreviewRow[];
}
