'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface ReportMetric {
  code: string;
  value: number | null;
  unit: string;
  /** How many records the number rests on. Zero is a fact, not a blank. */
  basis: number;
  unavailableReason?: string | null;
  definition: { formula: string; decision: string; owner: string };
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
    const header = [t('metric'), t('value'), t('unit'), t('basis'), t('formula')];
    const lines = rows.map((r) => [
      metricT(r.code),
      r.value ?? t('notYet'),
      r.unit,
      r.basis,
      r.definition.formula,
    ]);
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
                  {/* "Not yet" rather than zero, for the reason the dashboard
                      gives: nothing to compute from is not a result of zero. */}
                  {r.value === null ? (
                    <span className="muted">{t('notYet')}</span>
                  ) : (
                    <strong>
                      {r.value}
                      {r.unit === 'PERCENT' ? '%' : ''}
                    </strong>
                  )}
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
