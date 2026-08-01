'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface PartnerOption {
  id: string;
  legalName: string;
  approvalStatus: string;
  isBlacklisted: boolean;
}

export interface BoqOption {
  id: string;
  description: string;
  packageName: string;
}

interface Line {
  description: string;
  quantity: string;
  unitPrice: string;
  boqItemId: string;
}

const EMPTY_LINE: Line = { description: '', quantity: '1', unitPrice: '', boqItemId: '' };

/**
 * Entering a quotation that arrived from a supplier.
 *
 * The BOQ item on each line is the field that matters most and is easiest to
 * skip: without it the price cannot reach the costing, and the buyer finds out
 * only after selecting the offer. So it is offered inline on every line rather
 * than hidden behind an edit step, and the form says what is lost by leaving
 * it blank.
 *
 * Blacklisted partners are shown but not selectable. Hiding them would make
 * the list quietly wrong — "why isn't this supplier here?" is a worse question
 * than seeing the reason.
 */
export function NewQuotationForm({
  opportunityId,
  partners,
  boqItems,
  currency,
}: {
  opportunityId: string;
  partners: PartnerOption[];
  boqItems: BoqOption[];
  currency: string;
}) {
  const t = useTranslations('quotations');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0,
  );
  const unmapped = lines.filter((l) => l.description && !l.boqItemId).length;
  const usable = lines.filter((l) => l.description.trim() && l.unitPrice !== '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/quotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId,
          currency,
          validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
          deliveryDays: deliveryDays ? Number(deliveryDays) : undefined,
          items: usable.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            boqItemId: l.boqItemId || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setOpen(false);
      setPartnerId('');
      setLines([{ ...EMPTY_LINE }]);
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
        {t('enterQuotation')}
      </button>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>{t('enterQuotation')}</h3>
      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        <div className="field">
          <label>{t('partner')}</label>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">—</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id} disabled={p.isBlacklisted}>
                {p.legalName}
                {p.isBlacklisted ? ` — ${t('blacklisted')}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('validUntil')}</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('deliveryDays')}</label>
          <input
            type="number"
            value={deliveryDays}
            onChange={(e) => setDeliveryDays(e.target.value)}
          />
        </div>
      </div>

      <h4>{t('lines')}</h4>
      <table className="data">
        <thead>
          <tr>
            <th>{t('lineDescription')}</th>
            <th style={{ width: 90 }}>{t('quantity')}</th>
            <th style={{ width: 110 }}>{t('unitPrice')}</th>
            <th>{t('boqItem')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <input
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={l.unitPrice}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
                <select
                  value={l.boqItemId}
                  onChange={(e) => setLine(i, { boqItemId: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="">{t('noBoqItem')}</option>
                  {boqItems.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.packageName} — {b.description}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>
          {t('addLine')}
        </button>
        <span style={{ marginInlineStart: 'auto', fontWeight: 700 }}>
          {t('total')}: {total.toLocaleString()} {currency}
        </span>
      </div>

      {unmapped > 0 && (
        <div className="readiness not-ok" style={{ marginTop: 10 }}>
          <strong>{t('unmappedWarning', { n: unmapped })}</strong>
          <span>{t('unmappedHint')}</span>
        </div>
      )}

      <div className="form-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !partnerId || usable.length === 0}
          onClick={save}
        >
          {busy ? t('saving') : t('save')}
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
