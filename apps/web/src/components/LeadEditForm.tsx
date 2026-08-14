'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { refLabel, type RefLabels } from '@/lib/ref-labels';

export interface EditableLead {
  id: string;
  name: string;
  description: string | null;
  source: string;
  industry: string | null;
  estimatedValue: string | null;
  currency: string;
  nextStep: string | null;
  status: string;
}

/**
 * Editing the lead's own facts. Status, conversion and disqualification are not
 * here on purpose — those are decisions with their own rules and their own
 * audit meaning, and folding them into a general "save" would let someone
 * disqualify a lead by editing a field.
 */
export function LeadEditForm({
  lead,
  master,
  labels,
}: {
  lead: EditableLead;
  master: { leadSources: string[]; industries: string[]; currencies: string[] };
  labels: RefLabels;
}) {
  const t = useTranslations('leads');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: lead.name,
    description: lead.description ?? '',
    source: lead.source,
    industry: lead.industry ?? '',
    estimatedValue: lead.estimatedValue ?? '',
    currency: lead.currency,
    nextStep: lead.nextStep ?? '',
  });

  // The API refuses to edit a closed lead. Saying so before the click beats a
  // rejection after it.
  const closed = lead.status === 'CONVERTED' || lead.status === 'DISQUALIFIED';
  if (closed) return null;

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          // Empty strings would fail validation on optional fields, so a
          // cleared field is sent as an absent one rather than an empty one.
          description: form.description.trim() || undefined,
          source: form.source,
          industry: form.industry || undefined,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
          currency: form.currency,
          nextStep: form.nextStep.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(
          Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message ?? t('failed'),
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
      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="lead-name">{t('name')} *</label>
          <input
            id="lead-name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="lead-source">{t('source')} *</label>
          <select
            id="lead-source"
            value={form.source}
            onChange={(e) => set('source', e.target.value)}
          >
            {master.leadSources.map((s) => (
              <option key={s} value={s}>
                {refLabel(labels, 'LEAD_SOURCE', s)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lead-industry">{t('industry')}</label>
          <select
            id="lead-industry"
            value={form.industry}
            onChange={(e) => set('industry', e.target.value)}
          >
            <option value="">—</option>
            {master.industries.map((i) => (
              <option key={i} value={i}>
                {refLabel(labels, 'INDUSTRY', i)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lead-value">{t('value')}</label>
          <input
            id="lead-value"
            type="number"
            min="0"
            value={form.estimatedValue}
            onChange={(e) => set('estimatedValue', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="lead-currency">{t('currency')}</label>
          <select
            id="lead-currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            {master.currencies.map((c) => (
              <option key={c} value={c}>
                {refLabel(labels, 'CURRENCY', c)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lead-next">{t('nextStep')}</label>
          <input
            id="lead-next"
            value={form.nextStep}
            onChange={(e) => set('nextStep', e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="lead-desc">{t('description')}</label>
        <textarea
          id="lead-desc"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || form.name.trim().length < 2}
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
