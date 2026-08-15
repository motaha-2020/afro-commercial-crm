import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  FORECAST_CATEGORIES,
  HEALTH_STATES,
  OPPORTUNITY_IMPORT_COLUMNS,
  OPPORTUNITY_IMPORT_MAX_ROWS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
} from '@acms/shared';
import { OpportunityImport } from '@/components/OpportunityImport';

export const dynamic = 'force-dynamic';

/**
 * The column reference lives on the screen, not inside the template file.
 *
 * A template shipped with example rows in it is a template that gets imported
 * by accident the first time somebody forgets to delete them. The file it hands
 * out is therefore a header row and nothing else, and everything a person needs
 * in order to fill it in is here, next to the upload button, where it can also
 * be translated.
 */
const ALLOWED: Record<string, readonly string[]> = {
  stage: OPPORTUNITY_STAGES,
  status: OPPORTUNITY_STATUSES,
  forecastCategory: FORECAST_CATEGORIES,
  health: HEALTH_STATES,
};

export default async function OpportunityImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('opportunityImport');

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <Link
            className="page-back"
            href={`/${locale}/opportunities`}
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
            <h1>{t('title')}</h1>
            <p>{t('subtitle', { max: OPPORTUNITY_IMPORT_MAX_ROWS })}</p>
          </div>
        </div>
      </div>

      <OpportunityImport locale={locale} />

      <div className="panel" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('columnsTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('columnsHint')}
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>{t('column')}</th>
              <th>{t('meaning')}</th>
              <th>{t('required')}</th>
              <th>{t('accepts')}</th>
            </tr>
          </thead>
          <tbody>
            {OPPORTUNITY_IMPORT_COLUMNS.map((c) => (
              <tr key={c.key}>
                {/* The key itself, never translated: it is the header the file
                    must carry, and a translated one would not parse. */}
                <td>
                  <code>{c.key}</code>
                </td>
                <td>{t(`col_${c.key}`)}</td>
                <td>
                  {c.required ? (
                    <span className="badge badge-danger">{t('yes')}</span>
                  ) : (
                    <span className="muted">{t('no')}</span>
                  )}
                </td>
                <td style={{ fontSize: 12 }}>
                  {ALLOWED[c.key]
                    ? ALLOWED[c.key].join(' · ')
                    : c.kind === 'date'
                      ? t('dateFormat')
                      : c.list
                        ? t('fromRefList', { list: c.list })
                        : t(`kind_${c.kind}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
