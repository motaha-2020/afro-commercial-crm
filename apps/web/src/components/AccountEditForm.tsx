'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { refLabel, type RefLabels } from '@/lib/ref-labels';

export interface EditableAccount {
  id: string;
  legalName: string;
  tradeName: string | null;
  type: string;
  industry: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  taxId: string | null;
  paymentTermDays: number | null;
}

/**
 * Editing the customer's own facts.
 *
 * Credit standing is not here, and that is the point. Segregation of duties
 * rule 5 says whoever creates the customer does not approve its credit — and
 * the API enforces it — so putting the field on the same form the account
 * owner uses to fix a phone number would offer them a control that exists
 * only to be refused. Credit is decided by finance, on its own act.
 *
 * Country is absent for a plainer reason: the API does not accept it on an
 * update, because moving a legal entity between countries is a new record,
 * not an edit.
 */
export function AccountEditForm({
  account,
  master,
  labels,
}: {
  account: EditableAccount;
  master: { accountTypes: string[]; industries: string[] };
  labels: RefLabels;
}) {
  const t = useTranslations('accounts');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    legalName: account.legalName,
    tradeName: account.tradeName ?? '',
    type: account.type,
    industry: account.industry ?? '',
    city: account.city ?? '',
    address: account.address ?? '',
    website: account.website ?? '',
    taxId: account.taxId ?? '',
    paymentTermDays:
      account.paymentTermDays === null ? '' : String(account.paymentTermDays),
  });

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName.trim(),
          // Optional fields reject an empty string, so a cleared field is sent
          // as an absent one rather than as "".
          tradeName: form.tradeName.trim() || undefined,
          type: form.type,
          industry: form.industry || undefined,
          city: form.city.trim() || undefined,
          address: form.address.trim() || undefined,
          website: form.website.trim() || undefined,
          taxId: form.taxId.trim() || undefined,
          paymentTermDays: form.paymentTermDays
            ? Number(form.paymentTermDays)
            : undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(
          Array.isArray(payload.message)
            ? payload.message.join(' · ')
            : (payload.message ?? t('failed')),
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t('edit')}
      </button>
    );
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('editTitle')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('editHint')}
      </p>
      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="account-name">{t('name')} *</label>
          <input
            id="account-name"
            value={form.legalName}
            onChange={(e) => set('legalName', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="account-trade">{t('tradeName')}</label>
          <input
            id="account-trade"
            value={form.tradeName}
            onChange={(e) => set('tradeName', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="account-type">{t('type')} *</label>
          <select
            id="account-type"
            value={form.type}
            onChange={(e) => set('type', e.target.value)}
          >
            {master.accountTypes.map((c) => (
              <option key={c} value={c}>
                {refLabel(labels, 'ACCOUNT_TYPE', c)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="account-industry">{t('industry')}</label>
          <select
            id="account-industry"
            value={form.industry}
            onChange={(e) => set('industry', e.target.value)}
          >
            <option value="">—</option>
            {master.industries.map((c) => (
              <option key={c} value={c}>
                {refLabel(labels, 'INDUSTRY', c)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="account-city">{t('city')}</label>
          <input
            id="account-city"
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="account-tax">{t('taxId')}</label>
          <input
            id="account-tax"
            value={form.taxId}
            onChange={(e) => set('taxId', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="account-website">{t('website')}</label>
          <input
            id="account-website"
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="account-terms">{t('paymentTerms')}</label>
          <input
            id="account-terms"
            type="number"
            min="0"
            value={form.paymentTermDays}
            onChange={(e) => set('paymentTermDays', e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="account-address">{t('address')}</label>
        <input
          id="account-address"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || form.legalName.trim().length < 2}
          onClick={save}
        >
          {busy ? t('saving') : t('save')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
