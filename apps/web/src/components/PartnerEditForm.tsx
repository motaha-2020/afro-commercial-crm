'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface EditablePartner {
  id: string;
  legalName: string;
  tradeName: string | null;
  city: string | null;
  address: string | null;
  taxNumber: string | null;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
}

/**
 * Editing the partner's own facts — who they are and how to reach them.
 *
 * Approval standing, blacklisting and the type assignments are deliberately
 * absent: they belong to procurement and finance, they each carry their own
 * refusals and their own audit meaning, and the governance panel below is
 * where they are decided. Folding them into a general "save" here would turn
 * an address correction into a back door onto approval status.
 *
 * Country is absent for a different reason: the API does not accept it on an
 * update, and a field that silently does nothing is worse than no field.
 */
export function PartnerEditForm({ partner }: { partner: EditablePartner }) {
  const t = useTranslations('partners');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    legalName: partner.legalName,
    tradeName: partner.tradeName ?? '',
    city: partner.city ?? '',
    address: partner.address ?? '',
    taxNumber: partner.taxNumber ?? '',
    website: partner.website ?? '',
    contactName: partner.contactName ?? '',
    contactEmail: partner.contactEmail ?? '',
    contactPhone: partner.contactPhone ?? '',
    notes: partner.notes ?? '',
  });

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/partners/${partner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName.trim(),
          // Optional fields reject an empty string, so a cleared field is sent
          // as an absent one rather than as "".
          tradeName: form.tradeName.trim() || undefined,
          city: form.city.trim() || undefined,
          address: form.address.trim() || undefined,
          taxNumber: form.taxNumber.trim() || undefined,
          website: form.website.trim() || undefined,
          contactName: form.contactName.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          notes: form.notes.trim() || undefined,
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

  const fields: { key: keyof typeof form; label: string; type?: string }[] = [
    { key: 'legalName', label: `${t('name')} *` },
    { key: 'tradeName', label: t('tradeName') },
    { key: 'city', label: t('city') },
    { key: 'taxNumber', label: t('taxNumber') },
    { key: 'website', label: t('website') },
    { key: 'contactName', label: t('contact') },
    { key: 'contactEmail', label: t('contactEmail'), type: 'email' },
    { key: 'contactPhone', label: t('contactPhone') },
  ];

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('editTitle')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('editHint')}
      </p>
      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`partner-${f.key}`}>{f.label}</label>
            <input
              id={`partner-${f.key}`}
              type={f.type ?? 'text'}
              value={form[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="field">
        <label htmlFor="partner-address">{t('address')}</label>
        <input
          id="partner-address"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="partner-notes">{t('notes')}</label>
        <textarea
          id="partner-notes"
          rows={3}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
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
