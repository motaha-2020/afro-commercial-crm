'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const TYPES = [
  'VERBAL_AWARD',
  'LETTER_OF_INTENT',
  'PURCHASE_ORDER',
  'CONTRACT_RECEIVED',
  'CONTRACT_SIGNED',
  'NOTICE_TO_PROCEED',
] as const;

/** Everything below a purchase order is an expectation, not a commitment. */
const BINDING_FROM = TYPES.indexOf('PURCHASE_ORDER');

/**
 * Recording an award.
 *
 * The form says out loud whether what is being recorded is binding, because
 * the difference decides whether the project can be handed to operations at
 * all — and someone typing "verbal award" into a system usually believes they
 * have won the job.
 *
 * The ERP cost code appears only once the award is binding: Afro opens it under
 * the project cost centre after the award, so offering the field for a phone
 * call would invite a code that does not exist yet.
 */
export function RecordAwardForm({ opportunityId }: { opportunityId: string }) {
  const t = useTranslations('contract');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('PURCHASE_ORDER');
  const [awardedAt, setAwardedAt] = useState(new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState('');
  const [reference, setReference] = useState('');
  const [erpCostCode, setErpCostCode] = useState('');
  const [erpCostCenter, setErpCostCenter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const binding = TYPES.indexOf(type as (typeof TYPES)[number]) >= BINDING_FROM;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/awards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          awardedAt: new Date(awardedAt).toISOString(),
          awardedValue: value ? Number(value) : undefined,
          customerReference: reference || undefined,
          erpCostCode: erpCostCode || undefined,
          erpCostCenter: erpCostCenter || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setOpen(false);
      setValue('');
      setReference('');
      setErpCostCode('');
      setErpCostCenter('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        {t('recordAward')}
      </button>
    );
  }

  return (
    <div className="form-grid" style={{ marginTop: 12 }}>
      {error && (
        <p className="form-error" style={{ gridColumn: '1 / -1' }}>
          {error}
        </p>
      )}

      <div className="field">
        <label>{t('type')}</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{t('date')}</label>
        <input type="date" value={awardedAt} onChange={(e) => setAwardedAt(e.target.value)} />
      </div>

      <div className="field">
        <label>{t('value')}</label>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
        />
      </div>

      <div className="field">
        <label>{t('customerReference')}</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={t('customerReferencePlaceholder')}
        />
      </div>

      <div className={`readiness ${binding ? 'ok' : 'not-ok'}`} style={{ gridColumn: '1 / -1' }}>
        <strong>{binding ? t('willBeBinding') : t('willNotBeBinding')}</strong>
        <span>{binding ? t('bindingHint') : t('notBindingHint')}</span>
      </div>

      {/* Afro opens the code under the project cost centre after the award, so
          it is only worth asking for once the award is one. */}
      {binding && (
        <>
          <div className="field">
            <label>{t('erpCode')}</label>
            <input
              value={erpCostCode}
              onChange={(e) => setErpCostCode(e.target.value)}
              placeholder="OPP-2026-000001"
            />
          </div>
          <div className="field">
            <label>{t('erpCostCentre')}</label>
            <input value={erpCostCenter} onChange={(e) => setErpCostCenter(e.target.value)} />
          </div>
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? t('saving') : t('save')}
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
