'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { money } from '@/lib/format';

export interface MetricDefinition {
  code: string;
  formula: string;
  decision: string;
  owner: string;
  unit: 'CURRENCY' | 'PERCENT' | 'COUNT' | 'DAYS';
  gameable: boolean;
  gamingNote?: string;
}

export interface MetricValue {
  code: string;
  value: number | null;
  unit: MetricDefinition['unit'];
  basis: number;
  unavailableReason?: string;
  /**
   * Money metrics only: the amount per currency, never summed across them.
   * This is the authority on what currency a figure is in — `value` is only
   * populated when there is exactly one, and carries no label of its own.
   */
  byCurrency?: Record<string, number>;
  definition: MetricDefinition;
}

/**
 * The dashboard cards.
 *
 * Three things here are deliberate and easy to leave out.
 *
 * A metric with nothing to compute from says so rather than showing zero. A
 * win rate of 0% and a win rate nobody can calculate yet look identical
 * otherwise, and only one of them is bad news.
 *
 * The basis is shown whenever a number rests on very few records. "100%" from
 * a single closed deal is not the same fact as 100% from forty, and a
 * dashboard that renders them identically is how a board ends up confident
 * about noise.
 *
 * And the formula is one click away, because the argument that follows a
 * disputed figure should be about the business rather than about whose
 * arithmetic is right.
 *
 * A money figure takes its currency from the metric, not from the caller.
 * This component used to accept a `currency` prop and the dashboard passed the
 * literal 'USD', so a book held entirely in EGP was labelled USD 105.14M —
 * off by a factor of about fifty, and stated with complete confidence. The
 * metrics layer already reports the currency each figure is in and refuses to
 * add two together; nothing above it needs to guess, and no caller should be
 * able to override the answer with a label.
 */
export function MetricCards({ metrics }: { metrics: MetricValue[] }) {
  const t = useTranslations('metrics');
  const [openCode, setOpenCode] = useState<string | null>(null);

  /**
   * Money renders per currency. A single-currency book gets the one line it
   * always got; a mixed one gets a line each, because the sum across them is
   * not money in any currency and printing it under one label is a false
   * statement rather than an approximation.
   */
  const renderMoney = (m: MetricValue) => {
    const entries = Object.entries(m.byCurrency ?? {}).filter(([, v]) => v !== 0);
    if (entries.length === 0) return t('unavailable');
    return (
      <span style={entries.length > 1 ? { display: 'grid', gap: 2 } : undefined}>
        {entries
          .sort((a, b) => b[1] - a[1])
          .map(([code, sum]) => (
            <span key={code}>{money(sum, code)}</span>
          ))}
      </span>
    );
  };

  const format = (m: MetricValue) => {
    // Checked before the null guard: a mixed-currency metric has no single
    // `value` by design, but it does have figures worth showing.
    if (m.unit === 'CURRENCY') return renderMoney(m);
    if (m.value === null) return t('unavailable');
    switch (m.unit) {
      case 'PERCENT':
        return `${m.value}%`;
      case 'DAYS':
        return t('days', { n: m.value });
      default:
        return String(m.value);
    }
  };

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        {metrics.map((m) => {
          // A mixed-currency metric has no single `value` and still has
          // something to show, so "did this produce a figure" cannot be read
          // off `value` alone any more.
          const hasFigure =
            m.unit === 'CURRENCY'
              ? Object.values(m.byCurrency ?? {}).some((v) => v !== 0)
              : m.value !== null;
          const thin = hasFigure && m.basis > 0 && m.basis < 5;
          return (
            <div className="kpi" key={m.code}>
              <div className="label">{t(m.code)}</div>
              <div className="value" style={!hasFigure ? { color: 'var(--muted)' } : undefined}>
                {format(m)}
              </div>

              <div className="trend">
                {!hasFigure ? (
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                    {t('nothingToComputeFrom')}
                  </span>
                ) : (
                  <span style={{ color: thin ? 'var(--warning)' : 'var(--muted)', fontSize: 11 }}>
                    {t('basis', { n: m.basis })}
                    {thin ? ` — ${t('thinBasis')}` : ''}
                  </span>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginInlineStart: 6, padding: '0 6px' }}
                  onClick={() => setOpenCode(openCode === m.code ? null : m.code)}
                  aria-expanded={openCode === m.code}
                >
                  ?
                </button>
              </div>

              {openCode === m.code && (
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid var(--border)',
                    fontSize: 11,
                    color: 'var(--muted)',
                  }}
                >
                  <div>
                    <strong>{t('formula')}:</strong> {m.definition.formula}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <strong>{t('decision')}:</strong> {m.definition.decision}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <strong>{t('owner')}:</strong> {m.definition.owner}
                  </div>
                  {/* The question people skip. A metric someone can move
                      without doing the work will be moved without the work. */}
                  {m.definition.gameable && (
                    <div style={{ marginTop: 4, color: 'var(--warning)' }}>
                      <strong>{t('gameable')}:</strong> {m.definition.gamingNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
