'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PartnerOption } from './NewQuotationForm';

/**
 * Raising a request for quotation.
 *
 * The recipients are the whole point of the record: an RFQ addressed to nobody
 * cannot be issued, because issuing it would log the company as waiting for
 * replies it never asked anyone for. So the form counts them as you tick, and
 * the issue action stays out of reach until at least one is chosen.
 *
 * Approved partners are separated from the rest rather than filtered out —
 * a buyer often wants a price from a partner still under qualification, and
 * hiding them would look like the list was broken.
 */
export function NewRfqForm({
  opportunityId,
  partners,
}: {
  opportunityId: string;
  partners: PartnerOption[];
}) {
  const t = useTranslations('quotations');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [scope, setScope] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const selectable = partners.filter((p) => !p.isBlacklisted);
  const approved = selectable.filter((p) => p.approvalStatus === 'APPROVED');
  const others = selectable.filter((p) => p.approvalStatus !== 'APPROVED');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/rfqs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: scope || undefined,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          partnerIds: chosen,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setOpen(false);
      setTitle('');
      setChosen([]);
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
        {t('newRfq')}
      </button>
    );
  }

  const group = (label: string, list: PartnerOption[]) =>
    list.length > 0 && (
      <>
        <div style={{ color: 'var(--muted)', fontSize: 11, margin: '10px 0 4px' }}>{label}</div>
        {list.map((p) => (
          <label
            key={p.id}
            className="btn-row"
            style={{ padding: '4px 0', cursor: 'pointer', fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={chosen.includes(p.id)}
              onChange={() => toggle(p.id)}
              style={{ width: 'auto' }}
            />
            {p.legalName}
          </label>
        ))}
      </>
    );

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>{t('newRfq')}</h3>
      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        <div className="field">
          <label>{t('rfqTitle')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('dueAt')}</label>
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>

        <div className="field wide">
          <label>{t('rfqDescription')}</label>
          <textarea rows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>

        <div className="field wide">
          <label>
            {t('recipients')} — {t('chosenCount', { n: chosen.length })}
          </label>
          {group(t('approvedPartners'), approved)}
          {group(t('otherPartners'), others)}
          {selectable.length === 0 && <p className="muted">{t('noPartners')}</p>}
        </div>

        <div className="form-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !title.trim() || chosen.length === 0}
            onClick={save}
          >
            {busy ? t('saving') : t('save')}
          </button>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>
            {t('cancel')}
          </button>
          {chosen.length === 0 && (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('needRecipient')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
