'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { money } from '@/lib/format';

export interface ReportMetric {
  code: string;
  value: number | null;
  unit: string;
  /** How many records the number rests on. Zero is a fact, not a blank. */
  basis: number;
  unavailableReason?: string | null;
  /** Money and ratio measures: the figure per currency, never summed across. */
  byCurrency?: Record<string, number> | null;
  definition: { formula: string; decision: string; owner: string };
}

/**
 * One measure, written the way it is true.
 *
 * A money measure over a single currency reads as one figure. Over two it has
 * no single figure -- this screen printed "28465000" for a book holding
 * 8,465,000 USD and 20,000,000 EGP, a number that exists in neither currency
 * and that a board read as a total.
 */
function MeasureValue({ metric, notYet, mixed }: { metric: ReportMetric; notYet: string; mixed: string }) {
  const entries = Object.entries(metric.byCurrency ?? {});
  const isMoney = metric.unit === 'CURRENCY';

  if (metric.value !== null) {
    const only = entries[0]?.[0];
    return (
      <strong>
        {isMoney && only ? money(metric.value, only) : metric.value}
        {metric.unit === 'PERCENT' ? '%' : ''}
      </strong>
    );
  }

  if (metric.unavailableReason === 'MIXED_CURRENCY' && entries.length > 0) {
    return (
      <div className="measure-split">
        {entries.map(([code, amount]) => (
          <strong key={code}>
            {isMoney ? money(amount, code) : `${amount}% ${code}`}
          </strong>
        ))}
        <span className="muted">{mixed}</span>
      </div>
    );
  }

  // Nothing to compute from is not a result of zero.
  return <span className="muted">{notYet}</span>;
}

/**
 * A report the reader assembles: pick the measures, read them over the same
 * facts, take the table away.
 *
 * Deliberately built on the metric definitions rather than on free SQL. A
 * report writer that can express anything can express a win rate computed a
 * second way, and then two departments arrive at a meeting with two numbers
 * and the same name for them. Every line here carries the formula that
 * produced it, so a disagreement is about the definition rather than about
 * whose spreadsheet is right.
 */
export function ReportBuilder({
  available,
  initial,
}: {
  available: string[];
  initial: ReportMetric[];
}) {
  const t = useTranslations('reports');
  const metricT = useTranslations('metrics');

  const [selected, setSelected] = useState<string[]>(initial.map((m) => m.code));
  const [rows, setRows] = useState<ReportMetric[]>(initial);
  const [withheld, setWithheld] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(code: string) {
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?codes=${selected.join(',')}`);
      if (!res.ok) {
        setError(t('failed'));
        return;
      }
      const data = await res.json();
      setRows(data.metrics ?? []);
      setWithheld(data.withheld ?? []);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Download as CSV.
   *
   * The formula travels in the file. A number that leaves the system without
   * its definition is the beginning of the second version of the truth this
   * screen exists to prevent.
   */
  function download() {
    const header = [t('metric'), t('value'), t('currency'), t('unit'), t('basis'), t('formula')];
    // One line per currency, so a spreadsheet cannot re-create the merged
    // total this screen exists to stop showing.
    const lines = rows.flatMap((r) => {
      const entries = Object.entries(r.byCurrency ?? {});
      if (entries.length > 1) {
        return entries.map(([code, amount]) => [
          metricT(r.code),
          amount,
          code,
          r.unit,
          r.basis,
          r.definition.formula,
        ]);
      }
      return [[
        metricT(r.code),
        r.value ?? t('notYet'),
        entries[0]?.[0] ?? '',
        r.unit,
        r.basis,
        r.definition.formula,
      ]];
    });
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    // A BOM, so Excel opens Arabic without mangling it — the same reason the
    // import templates carry one.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `acms-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('choose')}</h2>
        <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {available.map((code) => (
            <label key={code} className="badge" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(code)}
                onChange={() => toggle(code)}
                style={{ marginInlineEnd: 6 }}
              />
              {metricT(code)}
            </label>
          ))}
        </div>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={run} disabled={busy || !selected.length}>
            {busy ? t('running') : t('run')}
          </button>
          <button type="button" className="btn" onClick={download} disabled={!rows.length}>
            {t('download')}
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {withheld.length > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            {t('withheld', { list: withheld.map((c) => metricT(c)).join(', ') })}
          </p>
        )}
      </div>

      <div className="panel">
        <table className="data">
          <thead>
            <tr>
              <th>{t('metric')}</th>
              <th>{t('value')}</th>
              <th>{t('basis')}</th>
              <th>{t('formula')}</th>
              <th>{t('owner')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td>{metricT(r.code)}</td>
                <td>
                  <MeasureValue metric={r} notYet={t('notYet')} mixed={t('mixedCurrency')} />
                </td>
                <td className="muted">{r.basis}</td>
                <td style={{ maxWidth: 380, fontSize: 12 }}>{r.definition.formula}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {r.definition.owner}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
