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
 * Only the fields the API needs at intake. Progressive Data Capture is the
 * point: the rest is asked for later, when the stage gate actually requires it,
 * rather than as a wall of inputs nobody can answer on day one.
 */
export function NewOpportunityForm({
  accounts,
  master,
  locale,
}: {
  accounts: AccountOption[];
  master: MasterData;
  locale: string;
}) {
  const t = useTranslations('newOpportunity');
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    accountId: accounts[0]?.id ?? '',
    country: accounts[0]?.country ?? master.countries[0] ?? 'EG',
    currency: 'USD',
    industry: '',
    source: '',
    estimatedValue: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  /** Picking the customer pre-fills their country — the usual case, still editable. */
  function pickAccount(id: string) {
    const account = accounts.find((a) => a.id === id);
    setForm((f) => ({ ...f, accountId: id, country: account?.country ?? f.country }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          accountId: form.accountId,
          country: form.country,
          currency: form.currency,
          industry: form.industry || undefined,
          source: form.source || undefined,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.push(`/${locale}/opportunities/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="panel">
        <p className="muted">{t('needAccount')}</p>
      </div>
    );
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
        <label htmlFor="accountId">{t('account')} *</label>
        <select id="accountId" value={form.accountId} onChange={(e) => pickAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.legalName} ({a.code})
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
        <label htmlFor="currency">{t('currency')}</label>
        <select id="currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
          {master.currencies.map((c) => (
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
        <label htmlFor="source">{t('source')}</label>
        <select id="source" value={form.source} onChange={(e) => set('source', e.target.value)}>
          <option value="">—</option>
          {master.leadSources.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy || form.name.length < 2}>
          {busy ? t('saving') : t('save')}
        </button>
        <p className="muted">{t('progressiveHint')}</p>
        {error && <p className="form-error">{error}</p>}
      </div>
    </form>
  );
}
