'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const PARTNER_TYPES = [
  'SUPPLIER',
  'SUBCONTRACTOR',
  'CONSULTANT',
  'LOCAL_PARTNER',
  'LOGISTICS_PROVIDER',
  'EQUIPMENT_RENTAL',
] as const;

/**
 * Types are checkboxes, not a dropdown: the spec's whole reason for one
 * Business Partner table is that a company supplies material AND installs it.
 */
export function NewPartnerForm({
  countries,
  locale,
}: {
  countries: string[];
  locale: string;
}) {
  const t = useTranslations('newPartner');
  const typeT = useTranslations('partners');
  const router = useRouter();

  const [form, setForm] = useState({
    legalName: '',
    tradeName: '',
    country: countries[0] ?? 'EG',
    city: '',
    taxNumber: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  });
  const [types, setTypes] = useState<string[]>(['SUPPLIER']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleType(type: string) {
    setTypes((s) => (s.includes(type) ? s.filter((x) => x !== type) : [...s, type]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName,
          tradeName: form.tradeName || undefined,
          country: form.country,
          city: form.city || undefined,
          taxNumber: form.taxNumber || undefined,
          contactName: form.contactName || undefined,
          contactEmail: form.contactEmail || undefined,
          contactPhone: form.contactPhone || undefined,
          types: types.length ? types : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.push(`/${locale}/partners/${data.id}`);
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
        <label htmlFor="country">{t('country')} *</label>
        <select id="country" value={form.country} onChange={(e) => set('country', e.target.value)}>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="city">{t('city')}</label>
        <input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="taxNumber">{t('taxNumber')}</label>
        <input
          id="taxNumber"
          value={form.taxNumber}
          onChange={(e) => set('taxNumber', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="contactName">{t('contactName')}</label>
        <input
          id="contactName"
          value={form.contactName}
          onChange={(e) => set('contactName', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="contactEmail">{t('contactEmail')}</label>
        <input
          id="contactEmail"
          type="email"
          value={form.contactEmail}
          onChange={(e) => set('contactEmail', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="contactPhone">{t('contactPhone')}</label>
        <input
          id="contactPhone"
          value={form.contactPhone}
          onChange={(e) => set('contactPhone', e.target.value)}
        />
      </div>

      <div className="field wide">
        <label>{t('types')}</label>
        <div className="btn-row">
          {PARTNER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`btn btn-sm${types.includes(type) ? ' btn-primary' : ''}`}
              onClick={() => toggleType(type)}
            >
              {typeT(type)}
            </button>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || form.legalName.length < 2}>
          {busy ? t('saving') : t('save')}
        </button>
        {error && <p className="form-error">{error}</p>}
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{t('approvalHint')}</p>
      </div>
    </form>
  );
}
