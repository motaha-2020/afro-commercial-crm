'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { refLabel, type RefLabels } from '@/lib/ref-labels';

interface MasterData {
  accountTypes: string[];
  industries: string[];
  countries: string[];
}

/**
 * Dropdowns are built from /master-data rather than hard-coded here, so the
 * codes the form can submit are exactly the ones the API accepts — the reason
 * the master-data endpoint exists at all.
 */
export function NewAccountForm({
  master,
  labels,
  locale,
}: {
  master: MasterData;
  labels: RefLabels;
  locale: string;
}) {
  const t = useTranslations('newAccount');
  const router = useRouter();

  const [form, setForm] = useState({
    legalName: '',
    tradeName: '',
    type: master.accountTypes[0] ?? 'OPERATOR',
    country: master.countries[0] ?? 'EG',
    industry: '',
    city: '',
    paymentTermDays: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName,
          // Empty strings would fail validation on optional fields, so they are
          // dropped rather than sent as blanks.
          tradeName: form.tradeName || undefined,
          type: form.type,
          country: form.country,
          industry: form.industry || undefined,
          city: form.city || undefined,
          paymentTermDays: form.paymentTermDays
            ? Number(form.paymentTermDays)
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.push(`/${locale}/accounts/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <div className="field">
        <label htmlFor="legalName">{t('legalName')} *</label>
        <input
          id="legalName"
          required
          minLength={2}
          value={form.legalName}
          onChange={(e) => set('legalName', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="tradeName">{t('tradeName')}</label>
        <input
          id="tradeName"
          value={form.tradeName}
          onChange={(e) => set('tradeName', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="type">{t('type')} *</label>
        <select id="type" value={form.type} onChange={(e) => set('type', e.target.value)}>
          {master.accountTypes.map((c) => (
            <option key={c} value={c}>
              {refLabel(labels, 'ACCOUNT_TYPE', c)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="country">{t('country')} *</label>
        <select id="country" value={form.country} onChange={(e) => set('country', e.target.value)}>
          {master.countries.map((c) => (
            <option key={c} value={c}>
              {refLabel(labels, 'COUNTRY', c)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="industry">{t('industry')}</label>
        <select id="industry" value={form.industry} onChange={(e) => set('industry', e.target.value)}>
          <option value="">—</option>
          {master.industries.map((c) => (
            <option key={c} value={c}>
              {refLabel(labels, 'INDUSTRY', c)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="city">{t('city')}</label>
        <input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="paymentTermDays">{t('paymentTerms')}</label>
        <input
          id="paymentTermDays"
          type="number"
          min={0}
          value={form.paymentTermDays}
          onChange={(e) => set('paymentTermDays', e.target.value)}
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy || form.legalName.length < 2}>
          {busy ? t('saving') : t('save')}
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    </form>
  );
}
