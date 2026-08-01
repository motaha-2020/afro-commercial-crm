'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';

export interface DocumentVersionRow {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  category: string;
  versions: DocumentVersionRow[];
  uploadedBy: { fullNameEn: string; fullNameAr: string };
}

const CATEGORIES = [
  'RFQ', 'RFP', 'TENDER', 'QUOTATION', 'COSTING', 'PROPOSAL', 'CONTRACT', 'DRAWING',
  'CORRESPONDENCE', 'OTHER',
] as const;

/**
 * Documents are polymorphic over entityType/entityId, so this panel embeds on
 * any entity's detail page without a dedicated route per entity.
 */
export function DocumentsPanel({
  entityType,
  entityId,
  documents,
}: {
  entityType: string;
  entityId: string;
  documents: DocumentRow[];
}) {
  const t = useTranslations('documents');
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const versionInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(file: File, opts: { title: string; category: string; documentId?: string }) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', opts.title);
      form.append('category', opts.category);
      form.append('entityType', entityType);
      form.append('entityId', entityId);
      if (opts.documentId) form.append('documentId', opts.documentId);

      const res = await fetch('/api/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError(t('fileRequired'));
      return;
    }
    const ok = await upload(file, { title, category });
    if (ok) {
      setTitle('');
      setCategory('OTHER');
      if (fileInput.current) fileInput.current.value = '';
      setOpen(false);
    }
  }

  async function submitVersion(doc: DocumentRow) {
    const input = versionInputs.current[doc.id];
    const file = input?.files?.[0];
    if (!file) {
      setError(t('fileRequired'));
      return;
    }
    const ok = await upload(file, { title: doc.title, category: doc.category, documentId: doc.id });
    if (ok && input) input.value = '';
  }

  function bytesToSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="panel">
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{t('title')}</h3>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? t('cancel') : t('upload')}
        </button>
      </div>

      {open && (
        <form className="form-grid" onSubmit={submitNew} style={{ margin: '12px 0' }}>
          <div className="field wide">
            <label htmlFor="docTitle">{t('docTitle')} *</label>
            <input
              id="docTitle"
              required
              minLength={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="docCategory">{t('category')}</label>
            <select id="docCategory" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="docFile">{t('file')} *</label>
            <input id="docFile" type="file" ref={fileInput} required />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || title.length < 2}>
              {busy ? t('uploading') : t('upload')}
            </button>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('docTitle')}</th>
            <th>{t('category')}</th>
            <th>{t('latestVersion')}</th>
            <th>{t('uploadedBy')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const latest = doc.versions[0];
            return (
              <tr key={doc.id}>
                <td>{doc.title}</td>
                <td>
                  <span className="badge">{t(doc.category)}</span>
                </td>
                <td>
                  {latest ? (
                    <>
                      <a href={`/api/documents/${doc.id}/download?versionId=${latest.id}`}>
                        {latest.fileName}
                      </a>
                      <div className="muted">
                        v{latest.version} • {bytesToSize(latest.sizeBytes)} •{' '}
                        {latest.createdAt.slice(0, 10)}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {locale === 'ar' ? doc.uploadedBy.fullNameAr : doc.uploadedBy.fullNameEn}
                </td>
                <td>
                  <div className="btn-row">
                    <input
                      type="file"
                      ref={(el) => {
                        versionInputs.current[doc.id] = el;
                      }}
                      style={{ maxWidth: 140, fontSize: 11 }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => submitVersion(doc)}
                    >
                      {t('addVersion')}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {documents.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                {t('empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
