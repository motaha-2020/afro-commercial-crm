import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IMPORT_MAX_ROWS, importDefinition } from '@acms/shared';
import { DataImport } from '@/components/DataImport';

export const dynamic = 'force-dynamic';

/**
 * One screen for every import.
 *
 * The columns are read from the shared definition rather than written out here,
 * so a column added to a resource appears in its template, its parser and this
 * reference at the same moment. Three hand-maintained copies of a column list
 * drift within a release.
 */

/** Where each resource sends you back to when you are done. */
const RETURNS: Record<string, (locale: string, ctx?: string) => string> = {
  accounts: (l) => `/${l}/accounts`,
  contacts: (l) => `/${l}/accounts`,
  leads: (l) => `/${l}/leads`,
  partners: (l) => `/${l}/partners`,
  opportunities: (l) => `/${l}/opportunities`,
  'scope-packages': (l, c) => (c ? `/${l}/opportunities/${c}/scope` : `/${l}/opportunities`),
  'scope-items': (l, c) => (c ? `/${l}/opportunities` : `/${l}/opportunities`),
  'boq-items': (l) => `/${l}/opportunities`,
};

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; resource: string }>;
  searchParams: Promise<{ contextId?: string; back?: string }>;
}) {
  const { locale, resource } = await params;
  const { contextId, back } = await searchParams;

  const definition = importDefinition(resource);
  if (!definition) notFound();

  const t = await getTranslations('dataImport');
  const rt = await getTranslations('importResources');

  // A resource whose rows all hang off one parent cannot be imported without
  // knowing the parent. Saying so beats an upload that fails on every row.
  const missingContext = definition.scope === 'context' && !contextId;

  const returnHref =
    back ?? RETURNS[resource]?.(locale, contextId) ?? `/${locale}/dashboard`;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <Link
            className="page-back"
            href={returnHref}
            aria-label={t('back')}
            title={t('back')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div>
            <h1>{t('title', { what: rt(resource) })}</h1>
            <p>{t('subtitle', { max: IMPORT_MAX_ROWS })}</p>
          </div>
        </div>
      </div>

      {missingContext ? (
        <div className="panel">
          <p className="form-error" style={{ marginTop: 0 }}>
            {t('needsContext')}
          </p>
          <Link className="btn" href={returnHref}>
            {t('back')}
          </Link>
        </div>
      ) : (
        <DataImport
          resource={resource}
          contextId={contextId}
          returnHref={returnHref}
          returnLabel={t('done')}
        />
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('columnsTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('columnsHint')}
        </p>
        {definition.tree && (
          /* The one genuinely unusual pair of columns, so it gets its own
             sentence rather than a line in a table nobody reads. */
          <p className="muted">{t('treeHint')}</p>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('column')}</th>
                <th>{t('required')}</th>
                <th>{t('accepts')}</th>
              </tr>
            </thead>
            <tbody>
              {definition.columns.map((c) => (
                <tr key={c.key}>
                  {/* The key itself, never translated: it is the header the
                      file must carry, and a translated one would not parse. */}
                  <td>
                    <code>{c.key}</code>
                  </td>
                  <td>
                    {c.required ? (
                      <span className="badge badge-danger">{t('yes')}</span>
                    ) : (
                      <span className="muted">{t('no')}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {c.allowed
                      ? c.allowed.join(' · ')
                      : c.list
                        ? t('fromRefList', { list: c.list })
                        : t(`kind_${c.kind}`)}
                    {c.fallback && ` — ${t('defaultsTo', { value: c.fallback })}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
