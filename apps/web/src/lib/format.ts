/**
 * The currency is required, and deliberately has no default.
 *
 * It used to default to USD, which meant any caller who forgot it got a
 * confidently mislabelled number rather than an error — a 15M EGP pipeline
 * rendered as "USD 15.00M" on the board for exactly that reason. A default
 * here is a machine for producing wrong labels; making it required moves the
 * mistake to compile time, where it costs nothing.
 */
export function money(
  value: number | string | null | undefined,
  currency: string,
): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}K`;
  return `${currency} ${n.toFixed(0)}`;
}

export function shortDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}
