/**
 * Never hand a raw ACMS response to a model.
 *
 * A single unprojected list ran 15 records × 38 fields ≈ 17,770 characters
 * (~4,400 tokens); two such calls blew the provider's context. Projection cuts
 * each row to the fields the answer needs and states plainly how much of the
 * result actually arrived.
 */

/** Roughly 1,500 tokens of rows — leaves room for the prompt and the answer. */
export const DEFAULT_CHAR_BUDGET = 6000;

export interface Projection<T> {
  items: T[];
  /** Numbers computed in code. The model quotes these; it never recomputes them. */
  facts: Record<string, unknown>;
  returned: number;
  total: number;
  truncated: boolean;
  note?: string;
}

/**
 * Truncates by character budget rather than row count: row width varies with
 * the length of its text, so a row cap alone does not cap the payload.
 */
export function project<TRow, TView>(
  rows: TRow[],
  opts: {
    view: (row: TRow) => TView;
    facts: Record<string, unknown>;
    charBudget?: number;
  },
): Projection<TView> {
  const budget = opts.charBudget ?? DEFAULT_CHAR_BUDGET;
  const items: TView[] = [];
  let spent = 0;

  for (const row of rows) {
    const projected = opts.view(row);
    const cost = JSON.stringify(projected).length + 1;
    // Always emit at least one row: an empty `items` reads as "no data in the
    // system", which is a different claim from "the first row did not fit".
    if (spent + cost > budget && items.length > 0) break;
    items.push(projected);
    spent += cost;
  }

  const truncated = items.length < rows.length;

  return {
    items,
    facts: opts.facts,
    returned: items.length,
    total: rows.length,
    truncated,
    note: truncated
      ? `عُرض ${items.length} من ${rows.length} — ضيّق البحث بفلتر للحصول على البقية.`
      : undefined,
  };
}
