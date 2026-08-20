/** Any ACMS record code: OPP-2026-000289, ACC-000114, QUO-…. */
export const RECORD_CODE_PATTERN = /\b[A-Z]{2,5}-\d{4}-\d{3,}\b|\b[A-Z]{2,5}-\d{4,}\b/g;

export interface EvidenceEntry {
  tool: string;
  resource: string;
  returned: number;
  total: number;
  truncated: boolean;
  codes: string[];
}

/**
 * What the tools actually handed over during one turn.
 *
 * The sources line under an answer is built from this ledger and never from
 * the model's own words, so the model cannot cite what it was not given. The
 * output guard reads the same ledger to catch a code that appears in an
 * answer without ever having been delivered.
 *
 * Request-scoped: a turn is one HTTP request, so this needs no store.
 */
export class EvidenceLedger {
  private readonly entries: EvidenceEntry[] = [];
  private readonly delivered = new Set<string>();

  record(entry: EvidenceEntry): void {
    this.entries.push(entry);
    entry.codes.forEach((code) => this.delivered.add(code));
  }

  /** Records a tool that failed, so a turn with no data is still explainable. */
  recordFailure(tool: string, resource: string): void {
    this.entries.push({ tool, resource, returned: 0, total: 0, truncated: false, codes: [] });
  }

  codes(): ReadonlySet<string> {
    return this.delivered;
  }

  all(): readonly EvidenceEntry[] {
    return this.entries;
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** The line printed under every answer. Built from the ledger, not the model. */
  sourceLine(): string | undefined {
    if (this.entries.length === 0) return undefined;

    const parts = this.entries.map((entry) => {
      const count = entry.truncated
        ? `${entry.returned} من ${entry.total}`
        : String(entry.returned);
      return `${entry.resource}: ${count}`;
    });

    return `المصادر — ${parts.join(' · ')}`;
  }
}

/** Pulls every record code out of a projected payload, for the ledger. */
export function codesFrom(items: unknown): string[] {
  const matches = JSON.stringify(items ?? '').match(RECORD_CODE_PATTERN);
  return matches ? [...new Set(matches)] : [];
}
