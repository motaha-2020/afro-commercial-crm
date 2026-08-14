'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BID_RATING_MAX, type BidDecision } from '@acms/shared';

interface Factor {
  code: string;
  titleAr: string;
  titleEn: string;
  weight: number;
}

interface Latest {
  id: string;
  score: string | number;
  suggestedDecision: BidDecision;
  decision: BidDecision | null;
  decisionRationale: string | null;
  ratings: Record<string, number>;
}

const DECISIONS: BidDecision[] = ['BID', 'BID_WITH_CONDITIONS', 'HOLD', 'NO_BID'];

/**
 * The 100-point assessment. Ratings run 0..5 per factor and the weight is shown
 * beside each one, so an assessor can see what their judgement is worth before
 * they make it rather than after.
 */
export function BidScoreForm({
  opportunityId,
  factors,
  latest,
  locale,
}: {
  opportunityId: string;
  factors: Factor[];
  latest: Latest | null;
  locale: string;
}) {
  const t = useTranslations('bid');
  const router = useRouter();

  const [ratings, setRatings] = useState<Record<string, number>>(
    () => (latest?.ratings as Record<string, number>) ?? {},
  );
  const [decision, setDecision] = useState<BidDecision | ''>(latest?.decision ?? '');
  const [rationale, setRationale] = useState(latest?.decisionRationale ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mirrors the server's weighted sum so the number moves as the user rates.
  const live = factors.reduce(
    (sum, f) => sum + f.weight * ((ratings[f.code] ?? 0) / BID_RATING_MAX),
    0,
  );

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? t('failed'));
    return data;
  }

  async function submitScore() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/opportunities/${opportunityId}/assess`, { ratings });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision() {
    if (!latest || !decision) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/bid-assessments/${latest.id}/decision`, {
        decision,
        rationale: rationale || undefined,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const overriding = Boolean(latest && decision && decision !== latest.suggestedDecision);

  return (
    <div className="score-panel">
      <div className="score-head">
        <div className="score-dial">
          <strong>{live.toFixed(1)}</strong>
          <span>/ 100</span>
        </div>
        <div>
          {latest ? (
            <>
              <div className="score-saved">
                {t('lastScored')}: <strong>{Number(latest.score).toFixed(1)}</strong>
              </div>
              <div className="score-suggested">
                {t('suggested')}: <span className={`badge decision-${latest.suggestedDecision}`}>
                  {t(latest.suggestedDecision)}
                </span>
              </div>
            </>
          ) : (
            <p className="score-empty">{t('never')}</p>
          )}
        </div>
      </div>

      <table className="data score-table">
        <thead>
          <tr>
            <th>{t('factor')}</th>
            <th>{t('weight')}</th>
            <th>{t('rating')}</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((f) => (
            <tr key={f.code}>
              <td>{locale === 'ar' ? f.titleAr : f.titleEn}</td>
              <td>{f.weight}</td>
              <td>
                <select
                  value={ratings[f.code] ?? ''}
                  onChange={(e) =>
                    setRatings((r) => ({ ...r, [f.code]: Number(e.target.value) }))
                  }
                  aria-label={locale === 'ar' ? f.titleAr : f.titleEn}
                >
                  <option value="">—</option>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" className="btn" onClick={() => void submitScore()} disabled={busy}>
        {t('saveScore')}
      </button>

      {latest && (
        <div className="decision-block">
          <h4>{t('decision')}</h4>
          <div className="decision-row">
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as BidDecision)}
              aria-label={t('decision')}
            >
              <option value="">—</option>
              {DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {t(d)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => void submitDecision()}
              disabled={busy || !decision}
            >
              {t('record')}
            </button>
          </div>

          {overriding && (
            // The API refuses an unexplained departure from its suggestion; say
            // so before the request, not after it fails.
            <>
              <p className="decision-warn">{t('overrideNeedsReason')}</p>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder={t('rationale')}
                rows={3}
              />
            </>
          )}

          {latest.decision && (
            <p className="decision-current">
              {t('recorded')}: <span className={`badge decision-${latest.decision}`}>
                {t(latest.decision)}
              </span>
            </p>
          )}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
