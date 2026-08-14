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
 */
export function MetricCards({
  metrics,
  currency,
}: {
  metrics: MetricValue[];
  currency: string;
}) {
  const t = useTranslations('metrics');
  const [openCode, setOpenCode] = useState<string | null>(null);

  const format = (m: MetricValue) => {
    if (m.value === null) return t('unavailable');
    switch (m.unit) {
      case 'CURRENCY':
        return money(m.value, currency);
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
          const thin = m.value !== null && m.basis > 0 && m.basis < 5;
          return (
            <div className="kpi" key={m.code}>
              <div className="label">{t(m.code)}</div>
              <div className="value" style={m.value === null ? { color: 'var(--muted)' } : undefined}>
                {format(m)}
              </div>

              <div className="trend">
                {m.value === null ? (
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
