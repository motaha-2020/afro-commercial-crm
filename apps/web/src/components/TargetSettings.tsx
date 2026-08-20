'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { money } from '@/lib/format';

export interface TargetRow {
  id: string;
  period: string;
  periodStart: string;
  metric: string;
  currency: string | null;
  value: number;
  note: string | null;
  user: { id: string; fullNameEn: string; fullNameAr: string } | null;
  orgUnit: { id: string; code: string; nameEn: string } | null;
  /** Null when the target cannot be measured — never zero. */
  actual: number | null;
  attainmentPercent: number | null;
  basis: number;
  unmeasurableReason: string | null;
  /** How far through the period we are. Without it a percentage says nothing. */
  periodElapsedPercent: number;
}

const METRICS = ['WON_VALUE', 'WON_COUNT', 'PIPELINE_VALUE'] as const;
const PERIODS = ['MONTH', 'QUARTER', 'YEAR'] as const;
const MONEY_METRICS = ['WON_VALUE', 'PIPELINE_VALUE'];

/**
 * Targets, and what has actually been done against them.
 *
 * The attainment bar carries a second mark for how far through the period we
 * are, because attainment alone cannot tell March from December: 40% of a year
 * is ahead in month five and a crisis in month eleven, and a bar without the
 * date reads the same either way.
 */
export function TargetSettings({
  targets,
  canEdit,
  people,
  units,
}: {
  targets: TargetRow[];
  canEdit: boolean;
  people: { id: string; label: string }[];
  units: { id: string; label: string }[];
}) {
  const t = useTranslations('targets');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    owner: '',
    period: 'QUARTER' as string,
    periodStart: '',
    metric: 'WON_VALUE' as string,
    currency: 'USD',
    value: '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMoney = MONEY_METRICS.includes(form.metric);

  async function submit() {
    setBusy(true);
    setError(null);

    const [kind, id] = form.owner.split(':');
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(kind === 'user' ? { userId: id } : { orgUnitId: id }),
          period: form.period,
          periodStart: new Date(`${form.periodStart}T00:00:00Z`).toISOString(),
          metric: form.metric,
          currency: isMoney ? form.currency : undefined,
          value: Number(form.value),
          note: form.note || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? t('failed'));

      setOpen(false);
      setForm({ ...form, value: '', note: '' });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/targets/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{t('title')}</h2>
        {canEdit && (
          <button type="button" onClick={() => setOpen(!open)}>
            {open ? t('cancel') : t('setTarget')}
          </button>
        )}
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        {t('subtitle')}
      </p>

      {!canEdit && (
        <div className="readiness not-ok" style={{ marginBottom: 12 }}>
          <strong>{t('readOnlyTitle')}</strong>
          <span>{t('readOnlyBody')}</span>
        </div>
      )}

      {open && canEdit && (
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div className="field">
            <label>{t('owner')}</label>
            <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
              <option value="">{t('pickOwner')}</option>
              <optgroup label={t('people')}>
                {people.map((p) => (
                  <option key={p.id} value={`user:${p.id}`}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('units')}>
                {units.map((u) => (
                  <option key={u.id} value={`unit:${u.id}`}>
                    {u.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="field-hint">{t('ownerHint')}</p>
          </div>

          <div className="field">
            <label>{t('metric')}</label>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
            >
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`metric_${m}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{t('period')}</label>
            <select
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`period_${p}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{t('periodStart')}</label>
            <input
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            />
          </div>

          <div className="field">
            <label>{t('value')}</label>
            <input
              type="number"
              min="1"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </div>

          {/* Only for money metrics. A count in USD is not a thing, and a field
              offering one invites a screen to print it. */}
          {isMoney && (
            <div className="field">
              <label>{t('currency')}</label>
              <input
                value={form.currency}
                maxLength={3}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </div>
          )}

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>{t('note')}</label>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !form.owner || !form.periodStart || !form.value}
            >
              {t('save')}
            </button>
            {error && <span className="danger">{error}</span>}
          </div>
        </div>
      )}

      <div className="target-list">
        {targets.map((row) => (
          <TargetCard key={row.id} row={row} canEdit={canEdit} onRemove={remove} busy={busy} />
        ))}
        {targets.length === 0 && <p className="muted">{t('none')}</p>}
      </div>
    </div>
  );
}

function TargetCard({
  row,
  canEdit,
  onRemove,
  busy,
}: {
  row: TargetRow;
  canEdit: boolean;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  const t = useTranslations('targets');

  const owner = row.user
    ? (row.user.fullNameAr ?? row.user.fullNameEn)
    : (row.orgUnit?.nameEn ?? '—');
  const isMoney = MONEY_METRICS.includes(row.metric);
  const fmt = (n: number) => (isMoney ? money(n, row.currency ?? '') : String(n));

  const percent = row.attainmentPercent;
  const band =
    percent === null
      ? 'unknown'
      : percent >= 100
        ? 'ahead'
        : percent >= 85
          ? 'on-track'
          : percent >= 60
            ? 'behind'
            : 'at-risk';

  return (
    <div className="target-card">
      <div className="target-head">
        <div>
          <strong>{owner}</strong>
          <span className="muted"> · {t(`metric_${row.metric}`)}</span>
        </div>
        <div className="muted">
          {t(`period_${row.period}`)} · {row.periodStart.slice(0, 10)}
        </div>
      </div>

      <div className="target-figures">
        <span>
          {/* Unmeasurable is not zero. A target in a currency this book has no
              deals in has no achievement, and 0% would read as failure. */}
          {row.actual === null ? (
            <span className="muted">{t(`unmeasurable_${row.unmeasurableReason}`)}</span>
          ) : (
            <strong>{fmt(row.actual)}</strong>
          )}
          <span className="muted"> / {fmt(row.value)}</span>
        </span>
        {percent !== null && <strong className={`target-pct ${band}`}>{percent}%</strong>}
      </div>

      <div className="target-track" role="img" aria-label={`${percent ?? 0}%`}>
        <span className={`target-fill ${band}`} style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
        {/* Where the calendar is. Without it the bar reads the same in March
            and in December. */}
        <span
          className="target-pace"
          style={{ insetInlineStart: `${row.periodElapsedPercent}%` }}
          title={t('elapsed', { n: row.periodElapsedPercent })}
        />
      </div>

      <div className="target-foot">
        <span className="muted">
          {t('elapsed', { n: row.periodElapsedPercent })} · {t('basis', { n: row.basis })}
        </span>
        {canEdit && (
          <button type="button" className="link-button" onClick={() => onRemove(row.id)} disabled={busy}>
            {t('remove')}
          </button>
        )}
      </div>
    </div>
  );
}
