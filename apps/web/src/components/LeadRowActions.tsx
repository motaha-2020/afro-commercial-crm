'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Archive, restore and remove, on the row rather than behind a click into the
 * record: tidying a list is a list-level job, and making someone open each lead
 * to file it is how lists stop getting tidied at all.
 */
export function LeadRowActions({
  id,
  archived,
  converted,
}: {
  id: string;
  archived: boolean;
  converted: boolean;
}) {
  const t = useTranslations('leads');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call(path: string, method: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(path, { method });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        // The API refuses to remove a converted lead and says why; replacing
        // that with a generic failure would hide the only useful part.
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
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() =>
          call(`/api/leads/${id}/${archived ? 'unarchive' : 'archive'}`, 'PATCH')
        }
      >
        {archived ? t('unarchive') : t('archive')}
      </button>

      {/* A converted lead is the origin record of a live opportunity. The API
          refuses to remove it; offering the button anyway would be an invitation
          to a refusal. */}
      {!converted && (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={() => {
            if (confirm(t('confirmDelete'))) call(`/api/leads/${id}`, 'DELETE');
          }}
        >
          {t('delete')}
        </button>
      )}

      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
