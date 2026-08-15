'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ImportPreview } from '@acms/shared';

type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done';

/**
 * Upload, look, then commit — for every importable thing.
 *
 * The middle step is the whole design. A hundred-row file with three bad rows
 * is the normal case, not the exception, and the two alternatives are both
 * worse: importing the good rows leaves someone comparing a spreadsheet against
 * a list by hand to find out what landed, and rejecting the file on the first
 * error sends them back to Excel knowing about one mistake out of three.
 * Showing every problem at once, before anything is written, is what makes a
 * file fixable in one pass.
 *
 * One component for all of them, because the differences between importing
 * customers and importing a bill of quantities are entirely in the columns, and
 * the columns are declared on the server.
 */
export function DataImport({
  resource,
  contextId,
  returnHref,
  returnLabel,
}: {
  resource: string;
  /** The record the rows attach to, when the whole file shares one parent. */
  contextId?: string;
  returnHref: string;
  returnLabel: string;
}) {
  const t = useTranslations('dataImport');
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(0);

  const query = contextId ? `?contextId=${encodeURIComponent(contextId)}` : '';

  function reset() {
    setPhase('idle');
    setFileName('');
    setCsv('');
    setPreview(null);
    setError('');
    setImported(0);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function send(text: string, mode: 'preview' | 'commit') {
    const sep = query ? '&' : '?';
    const res = await fetch(`/api/imports/${resource}${query}${sep}mode=${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: text }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = Array.isArray(payload.message)
        ? payload.message.join(' · ')
        : (payload.message ?? t('failed'));
      // A file missing a whole column is a different failure from a file with a
      // few bad rows, and naming the columns saves a guessing game.
      setError(
        payload.missingColumns?.length
          ? `${message}: ${payload.missingColumns.join(', ')}`
          : message,
      );
      setPhase(mode === 'commit' ? 'checked' : 'idle');
      return null;
    }
    return payload;
  }

  async function check(text: string) {
    const payload = (await send(text, 'preview')) as ImportPreview | null;
    if (payload) {
      setPreview(payload);
      setPhase('checked');
    }
  }

  async function onPick(file: File) {
    setError('');
    setPreview(null);
    setFileName(file.name);
    setPhase('checking');
    try {
      // Read as text here, checked on the server. The file itself is never
      // stored: a rejected import should leave nothing to clean up.
      const text = await file.text();
      setCsv(text);
      await check(text);
    } catch {
      setError(t('unreadable'));
      setPhase('idle');
    }
  }

  async function commit() {
    setPhase('importing');
    setError('');
    const payload = await send(csv, 'commit');
    if (payload) {
      setImported(payload.imported ?? 0);
      setPhase('done');
      router.refresh();
    }
  }

  const badRows = preview?.rows.filter((r) => r.errors.length > 0) ?? [];
  // Read before canImport is formed: once canImport narrows phase to 'checked',
  // asking whether it is 'importing' is a comparison the compiler knows can
  // never be true.
  const importing = phase === 'importing';
  const canImport =
    phase === 'checked' && !!preview && preview.validRows > 0 && badRows.length === 0;

  if (phase === 'done') {
    return (
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('doneTitle')}</h2>
        <p>{t('doneBody', { n: imported })}</p>
        <div className="btn-row">
          <a className="btn btn-primary" href={returnHref}>
            {returnLabel}
          </a>
          <button type="button" className="btn" onClick={reset}>
            {t('importAnother')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="btn-row" style={{ marginBottom: 12 }}>
        {/* A plain link, so the browser saves the file itself. */}
        <a className="btn" href={`/api/imports/${resource}/template`} download>
          {t('downloadTemplate')}
        </a>

        <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
          {t('chooseFile')}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
          />
        </label>

        {fileName && <span className="muted">{fileName}</span>}
        {phase === 'checking' && <span className="muted">{t('checking')}</span>}
      </div>

      {error && <p className="form-error">{error}</p>}

      {preview && (
        <>
          <p className={badRows.length > 0 ? 'form-error' : 'muted'}>
            {badRows.length > 0
              ? t('summaryBad', {
                  total: preview.totalRows,
                  ok: preview.validRows,
                  bad: badRows.length,
                })
              : t('summaryOk', { total: preview.totalRows })}
          </p>

          {badRows.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('line')}</th>
                    <th>{t('column')}</th>
                    <th>{t('problem')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Every problem, not the first: the point of a preview is to
                      need only one trip back to the spreadsheet. */}
                  {badRows.flatMap((row) =>
                    row.errors.map((e, i) => (
                      <tr key={`${row.line}-${i}`}>
                        <td>{row.line}</td>
                        <td>{e.column ?? '—'}</td>
                        <td>{e.message}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            preview.rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('line')}</th>
                      <th>{t('record')}</th>
                      <th>{t('attachesTo')}</th>
                      <th>{t('alsoCreates')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 25).map((row) => (
                      <tr key={row.line}>
                        <td>{row.line}</td>
                        <td>{row.label}</td>
                        <td>{row.parentLabel ?? '—'}</td>
                        {/* Said out loud: importing opportunities is not
                            obviously a thing that creates people. */}
                        <td>{row.createsLabel ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {preview.rows.length > 25 && badRows.length === 0 && (
            <p className="muted">{t('andMore', { n: preview.rows.length - 25 })}</p>
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canImport || importing}
              onClick={commit}
            >
              {importing ? t('importing') : t('confirmImport', { n: preview.validRows })}
            </button>
            <button type="button" className="btn" onClick={reset}>
              {t('cancel')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
