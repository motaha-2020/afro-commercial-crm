'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OPPORTUNITY_STAGES, STAGE_ORDER, type OpportunityStage } from '@acms/shared';

/**
 * Moving the deal along — the one act the whole thirteen-stage journey is made
 * of, and the one that had no control anywhere in the app.
 *
 * The refusal is the reason this exists rather than a side effect of it. The
 * API answers a premature move with the fields that are missing, by name, and
 * that answer is worth more than the move itself: it tells whoever is looking
 * exactly what the deal still owes before it can go forward.
 */
export function StageAdvance({
  opportunityId,
  stage,
}: {
  opportunityId: string;
  stage: string;
}) {
  const t = useTranslations('stageMove');
  const stageT = useTranslations('stage');
  const fieldT = useTranslations('stageField');
  const router = useRouter();

  const rank = STAGE_ORDER[stage as OpportunityStage] ?? 0;
  const next = OPPORTUNITY_STAGES.find((s) => STAGE_ORDER[s] === rank + 1);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(next ?? stage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  async function move(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMissing([]);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage: target, reason: reason || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Named, not counted. "3 fields missing" sends someone hunting; the
        // names send them straight to the three fields.
        setMissing(Array.isArray(body.missingFields) ? body.missingFields : []);
        setError(
          Array.isArray(body.message) ? body.message.join(' • ') : (body.message ?? t('failed')),
        );
        return;
      }
      setReason('');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage-move">
      <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? t('cancel') : next ? t('moveTo', { stage: stageT(next) }) : t('move')}
      </button>

      {open && (
        <form className="btn-row" onSubmit={move} style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <select
            aria-label={t('targetStage')}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {OPPORTUNITY_STAGES.filter((s) => s !== stage).map((s) => (
              <option key={s} value={s}>
                {stageT(s)}
              </option>
            ))}
          </select>
          <input
            value={reason}
            placeholder={t('reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
            {busy ? t('moving') : t('confirm')}
          </button>
        </form>
      )}

      {error && (
        <div className="readiness not-ok" style={{ marginTop: 10 }}>
          <strong>{t('refused')}</strong>
          <span>{error}</span>
          {missing.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
              {missing.map((f) => (
                <li key={f}>{fieldT(f)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
