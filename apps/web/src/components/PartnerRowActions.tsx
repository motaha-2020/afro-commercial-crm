'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Edit and remove, on the row. Editing opens the partner's own screen rather
 * than a popup here: a partner's facts are long enough that a row-height form
 * would hide most of them.
 */
export function PartnerRowActions({
  id,
  editHref,
  hasSelectedQuotation,
}: {
  id: string;
  editHref: string;
  hasSelectedQuotation: boolean;
}) {
  const t = useTranslations('partners');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/partners/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.message ?? t('failed'));
        return;
      }
      router.refresh();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="btn-row">
      <Link className="btn btn-sm" href={editHref}>
        {t('edit')}
      </Link>

      {/* A partner whose quotation was chosen is part of a priced bid; the API
          refuses to remove them and points at blacklisting instead. Offering
          the button anyway would be an invitation to a refusal. */}
      {!hasSelectedQuotation && (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={() => {
            if (confirm(t('confirmDelete'))) remove();
          }}
        >
          {t('delete')}
        </button>
      )}

      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
