import type { Prisma } from '@prisma/client';
import type { ImportDefinition, ImportRowError } from '@acms/shared';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Whatever the whole file hangs off: a scope package, a costing package. */
export interface ImportContext {
  id?: string;
  label?: string;
  [key: string]: unknown;
}

/** A row that survived validation, waiting to be written. */
export interface RowValues {
  line: number;
  /** This row's handle inside the file, for children to point at. */
  ref?: string;
  parentRef?: string;
  data: Record<string, unknown>;
  /** Anything the adapter resolved and does not want to look up twice. */
  extra?: Record<string, unknown>;
}

export interface ResolveInput {
  line: number;
  /** Cells already parsed to their declared kind. */
  values: Record<string, unknown>;
  /** The same cells as raw trimmed text, for lookups by name. */
  raw: Record<string, string>;
  errors: ImportRowError[];
  lookups: Record<string, unknown>;
  user: AuthenticatedUser;
  context: ImportContext;
}

export interface Resolved {
  /** What this row will be called in the preview. */
  label: string;
  parentLabel?: string | null;
  /** A record this row creates in passing — a contact, say — named out loud. */
  createsLabel?: string | null;
  data: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface CreateHelpers {
  /** The id of the row this one named as its parent, already written. */
  parentId?: string;
  prepared?: unknown;
  created: { id: string; label: string; line: number }[];
}

/**
 * What only the entity itself can know.
 *
 * The engine has already checked quoting, headers, required cells, codes,
 * numbers, dates and the shape of the tree. An adapter answers three questions:
 * what does the whole file hang off, what makes one of MY rows wrong, and how
 * is one written.
 */
export interface ImportAdapter {
  definition: ImportDefinition;
  /** Audited under this name, matching what the entity is called elsewhere. */
  entityType: string;

  /**
   * Resolve and authorise the parent for the whole file. Called before parsing
   * so that a locked costing version stops the upload once, rather than
   * appearing as five hundred identical row errors.
   */
  loadContext(user: AuthenticatedUser, contextId?: string): Promise<ImportContext>;

  /**
   * Fetch every lookup the rows will be checked against, once. Five hundred
   * rows must not become five hundred round trips asking the same question
   * about the same customer.
   */
  prepare(
    user: AuthenticatedUser,
    context: ImportContext,
    rowCount: number,
  ): Promise<Record<string, unknown>>;

  /** Entity-specific validation and shaping. Push to `errors` to reject. */
  resolve(input: ResolveInput): Resolved | null;

  /** Write one row inside the shared transaction. */
  create(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    row: RowValues,
    context: ImportContext,
    helpers: CreateHelpers,
  ): Promise<{ id: string; label: string }>;

  /** Anything needing a pre-transaction step, such as reserving a code run. */
  beforeCommit?(
    user: AuthenticatedUser,
    rows: RowValues[],
    context: ImportContext,
  ): Promise<unknown>;
}
