'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { money } from '@/lib/format';

export interface ComparisonViews {
  lowestPriceId: string | null;
  lowestLandedCostId: string | null;
  bestTechnicalId: string | null;
  bestOverallValueId: string | null;
  recommendedId: string | null;
  ineligible: { id: string; reason: string }[];
}

export interface ComparisonRow {
  id: string;
  code: string;
  partner: { id: string; legalName: string; isBlacklisted: boolean; approvalStatus: string };
  totalValue: string;
  landedAdjustment: string | null;
  currency: string;
  deliveryDays: number | null;
  validUntil: string | null;
  isExpired: boolean;
  isSelected: boolean;
  technicalStatus: string;
  commercialStatus: string;
  evaluation: { weightedScore: string | null; technicalScore: number | null } | null;
}

/**
 * The supplier comparison screen the spec asks for.
 *
 * It shows FOUR winners side by side rather than one, because they routinely
 * disagree — the cheapest offer is often neither the cheapest delivered nor the
 * best technically, and that disagreement is the information a buyer needs.
 * Nothing here selects anything: "يجب ألا يختار النظام أقل سعر تلقائيًا".
 */
export function QuotationComparison({
  views,
  rows,
  weights,
}: {
  views: ComparisonViews;
  rows: ComparisonRow[];
  weights: Record<string, number>;
}) {
  const t = useTranslations('quotations');
  const router = useRouter();

  const [rationale, setRationale] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ineligible = new Map(views.ineligible.map((i) => [i.id, i.reason]));

  const headlines = [
    { key: 'lowestPrice', id: views.lowestPriceId },
    { key: 'lowestLanded', id: views.lowestLandedCostId },
    { key: 'bestTechnical', id: views.bestTechnicalId },
    { key: 'bestOverall', id: views.bestOverallValueId },
  ];

  const nameOf = (id: string | null) =>
    id ? (rows.find((r) => r.id === id)?.partner.legalName ?? '—') : '—';

  async function select(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotations/${id}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rationale: rationale || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setChoosing(null);
      setRationale('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('comparison')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>{t('noAutoPick')}</p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {headlines.map((h) => (
          <div className="kpi" key={h.key}>
            <div className="label">{t(h.key)}</div>
            <div className="value" style={{ fontSize: 15 }}>
              {nameOf(h.id)}
            </div>
            {h.id && h.id === views.recommendedId && (
              <div className="trend">
                <span className="badge badge-primary">{t('recommended')}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('partner')}</th>
              <th>{t('price')}</th>
              <th>{t('landed')}</th>
              <th>{t('delivery')}</th>
              <th>{t('technical')}</th>
              <th>{t('score')}</th>
              <th>{t('validUntil')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const blocked = ineligible.get(r.id);
              return (
                <tr key={r.id} style={blocked ? { opacity: 0.55 } : undefined}>
                  <td>
                    {r.partner.legalName}
                    {r.isSelected && (
                      <span className="badge badge-success" style={{ marginInlineStart: 6 }}>
                        {t('selected')}
                      </span>
                    )}
                    {blocked && (
                      <div>
                        <span className="badge badge-danger">{t(blocked)}</span>
                      </div>
                    )}
                  </td>
                  <td>{money(r.totalValue, r.currency)}</td>
                  <td>
                    {money(
                      String(Number(r.totalValue) + Number(r.landedAdjustment ?? 0)),
                      r.currency,
                    )}
                  </td>
                  <td>{r.deliveryDays ? t('days', { n: r.deliveryDays }) : '—'}</td>
                  <td>{t(r.technicalStatus)}</td>
                  <td>
                    {r.evaluation?.weightedScore
                      ? `${Number(r.evaluation.weightedScore).toFixed(1)}`
                      : t('notEvaluated')}
                  </td>
                  <td>
                    {r.validUntil ? r.validUntil.slice(0, 10) : '—'}
                    {r.isExpired && (
                      <span className="badge badge-danger" style={{ marginInlineStart: 6 }}>
                        {t('expired')}
                      </span>
                    )}
                  </td>
                  <td>
                    {!r.isSelected && !blocked && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => setChoosing(choosing === r.id ? null : r.id)}
                      >
                        {t('select')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: 'var(--muted)' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {choosing && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="rationale">
            {choosing === views.recommendedId ? t('rationaleOptional') : t('rationaleRequired')}
          </label>
          <textarea
            id="rationale"
            rows={2}
            value={rationale}
            placeholder={t('rationalePlaceholder')}
            onChange={(e) => setRationale(e.target.value)}
            style={{ width: '100%', padding: 9, borderRadius: 9, border: '1px solid var(--border)' }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={
              busy || (choosing !== views.recommendedId && rationale.trim().length === 0)
            }
            onClick={() => select(choosing)}
          >
            {busy ? t('working') : t('confirmSelect')}
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <p style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 0 }}>
        {t('weightsInForce')}:{' '}
        {Object.entries(weights)
          .map(([k, v]) => `${t(k)} ${v}%`)
          .join(' · ')}
      </p>
    </div>
  );
}
