/**
 * Turns the reference lists returned by /master-data into code → label lookups
 * for one locale.
 *
 * Labels live with the values now rather than in the translation files, because
 * an administrator who adds an industry cannot edit those files — and a value
 * that renders as a bare code on a screen is the problem the lists were built
 * to remove.
 */
export interface RefListPayload {
  key: string;
  items: { code: string; labelEn: string; labelAr: string; labelFr: string }[];
}

export type RefLabels = Record<string, Record<string, string>>;

export function buildRefLabels(
  lists: RefListPayload[] | undefined,
  locale: string,
): RefLabels {
  const pick = (i: RefListPayload['items'][number]) =>
    locale === 'ar' ? i.labelAr : locale === 'fr' ? i.labelFr : i.labelEn;

  const out: RefLabels = {};
  for (const list of lists ?? []) {
    out[list.key] = Object.fromEntries(list.items.map((i) => [i.code, pick(i)]));
  }
  return out;
}

/** Falls back to the code: a missing label is a gap to see, not a blank cell. */
export function refLabel(labels: RefLabels, listKey: string, code: string) {
  return labels[listKey]?.[code] ?? code;
}
