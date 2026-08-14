'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface AccountOption {
  id: string;
  code: string;
  legalName: string;
  country: string;
}

interface MasterData {
  industries: string[];
  leadSources: string[];
  currencies: string[];
  countries: string[];
}

/**
 * A lead is deliberately cheaper to open than an opportunity: the company
 * behind an enquiry is often not known yet, so the account is optional here
 * and becomes mandatory only at conversion.
 */
export function NewLeadForm({
  accounts,
  master,
  locale,
}: {
  accounts: AccountOption[];
  master: MasterData;
  locale: string;
}) {
  const t = useTranslations('newLead');
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    source: master.leadSources[0] ?? 'OTHER',
    country: master.countries[0] ?? 'EG',
    accountId: '',
    industry: '',
    currency: 'USD',
    estimatedValue: '',
    description: '',
    nextStep: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function pickAccount(id: string) {
    const account = accounts.find((a) => a.id === id);
    setForm((f) => ({ ...f, accountId: id, country: account?.country ?? f.country }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          source: form.source,
          country: form.country,
          accountId: form.accountId || undefined,
          industry: form.industry || undefined,
          currency: form.currency,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
          description: form.description || undefined,
          nextStep: form.nextStep || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.push(`/${locale}/leads/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <div className="field wide">
        <label htmlFor="name">{t('name')} *</label>
        <input
          id="name"
          required
          minLength={2}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </div>

      <div className="field">
        <label htmlFor="source">{t('source')} *</label>
        <select id="source" value={form.source} onChange={(e) => set('source', e.target.value)}>
          {master.leadSources.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="accountId">{t('account')}</label>
        <select id="accountId" value={form.accountId} onChange={(e) => pickAccount(e.target.value)}>
          <option value="">{t('accountUnknown')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.legalName}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="country">{t('country')} *</label>
        <select id="country" value={form.country} onChange={(e) => set('country', e.target.value)}>
          {master.countries.map((c) => (
            <option key={c} value={c}>
              {c}
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
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="estimatedValue">{t('estimatedValue')}</label>
        <input
          id="estimatedValue"
          type="number"
          min={0}
          value={form.estimatedValue}
          onChange={(e) => set('estimatedValue', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="currency">{t('currency')}</label>
        <select id="currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
          {master.currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="field wide">
        <label htmlFor="nextStep">{t('nextStep')}</label>
        <input
          id="nextStep"
          value={form.nextStep}
          onChange={(e) => set('nextStep', e.target.value)}
          placeholder={t('nextStepPlaceholder')}
        />
      </div>

      <div className="field wide">
        <label htmlFor="description">{t('description')}</label>
        <textarea
          id="description"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || form.name.length < 2}>
          {busy ? t('saving') : t('save')}
        </button>
        {error && <p className="form-error">{error}</p>}
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{t('hint')}</p>
      </div>
    </form>
  );
}
