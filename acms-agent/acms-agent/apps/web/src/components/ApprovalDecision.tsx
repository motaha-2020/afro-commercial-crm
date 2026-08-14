'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface FiredRule {
  ruleId: string;
  requiredRole: string;
  conditionField: string;
  operator: string;
  threshold: number | null;
  actual: number | boolean;
  reason?: string | null;
}

const DECISIONS = ['APPROVE', 'APPROVE_WITH_CONDITIONS', 'RETURN_FOR_REVISION', 'REJECT'] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * The four verbs the spec gives an approver — Approve, Reject, Return for
 * Revision, Approve with Conditions — kept as four distinct acts rather than a
 * yes/no with a comment box.
 *
 * "Return for revision" is the one that earns its place: it is not a softer
 * rejection but a different outcome, and collapsing the two would lose the
 * distinction between a deal that is dead and a deal that needs another pass.
 *
 * A conditional approval will not submit without its conditions written down,
 * and a rejection will not submit without a reason: "لا موافقات شفوية غير
 * مسجلة", and a condition nobody wrote down is not a condition.
 */
export function ApprovalDecision({
  requestId,
  fired,
  undetermined,
}: {
  requestId: string;
  fired: FiredRule[];
  undetermined: { ruleId: string; reason: string }[];
}) {
  const t = useTranslations('approvals');
  const router = useRouter();

  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState('');
  const [conditions, setConditions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsComment = decision === 'REJECT' || decision === 'RETURN_FOR_REVISION';
  const needsConditions = decision === 'APPROVE_WITH_CONDITIONS';
  const blocked =
    !decision ||
    (needsComment && !comment.trim()) ||
    (needsConditions && !conditions.trim());

  async function submit() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${requestId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          comment: comment || undefined,
          conditions: conditions || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setDecision(null);
      setComment('');
      setConditions('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0, fontSize: 14 }}>{t('whyAsked')}</h3>

      {fired.length === 0 && undetermined.length === 0 && (
        <p className="muted">{t('noTriggers')}</p>
      )}

      <ul style={{ margin: '0 0 14px', paddingInlineStart: 18, fontSize: 13 }}>
        {fired.map((f) => (
          <li key={f.ruleId}>
            <strong>{t(f.conditionField)}</strong>{' '}
            {typeof f.actual === 'boolean' ? (
              t('isTrue')
            ) : (
              <>
                {String(f.actual)} {t(f.operator)} {f.threshold}
              </>
            )}{' '}
            → <span className="badge badge-primary">{f.requiredRole}</span>
            {f.reason && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{f.reason}</div>}
          </li>
        ))}
        {undetermined.map((u) => (
          <li key={u.ruleId} style={{ color: 'var(--warning)' }}>
            {/* Not a pass. An unanswered question reaches the approver as one. */}
            {t(u.reason)}
          </li>
        ))}
      </ul>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <div className="btn-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {DECISIONS.map((d) => (
          <button
            key={d}
            className={`btn btn-sm ${decision === d ? '' : 'btn-ghost'}`}
            onClick={() => setDecision(d)}
          >
            {t(d)}
          </button>
        ))}
      </div>

      {decision && (
        <div className="form-grid">
          {needsConditions && (
            <div className="field wide">
              <label>{t('conditions')}</label>
              <textarea
                rows={2}
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                placeholder={t('conditionsPlaceholder')}
              />
            </div>
          )}
          <div className="field wide">
            <label>{needsComment ? t('reasonRequired') : t('commentOptional')}</label>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="form-actions">
            <button className="btn" disabled={blocked || busy} onClick={submit}>
              {busy ? t('working') : t('record')}
            </button>
            <button className="btn btn-ghost" onClick={() => setDecision(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
