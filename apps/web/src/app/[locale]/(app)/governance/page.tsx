import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface SodRule {
  code: string;
  titleAr: string;
  titleEn: string;
  originatingAction: string;
  blockedAction: string;
  entityTypes: string[];
  awaitingRelease: number | null;
  enforced: boolean;
}

/**
 * The eight segregation-of-duties rules, as the system holds them.
 *
 * Shown in the spec's own wording rather than paraphrased, because the audience
 * for this screen is a reviewer who will compare it against the requirements
 * document line by line. A rule that reads differently here than there is a
 * rule somebody has to stop and reconcile.
 *
 * The rules that are not yet enforced are listed too, with the release that
 * brings the missing half. Hiding them would make the governance picture look
 * complete, which is the one thing this screen must never do.
 */
export default async function GovernancePage() {
  const t = await getTranslations('governance');
  const token = await getAccessToken();

  const data = await apiFetch<{ rules: SodRule[] }>('/governance/sod-rules', { token }).catch(
    () => ({ rules: [] as SodRule[] }),
  );

  const enforced = data.rules.filter((r) => r.enforced);
  const waiting = data.rules.filter((r) => !r.enforced);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <div className="panel">
        <div className={`readiness ${waiting.length === 0 ? 'ok' : 'not-ok'}`}>
          <strong>{t('enforcedCount', { n: enforced.length, total: data.rules.length })}</strong>
          <span>{t('enforcedHint')}</span>
        </div>

        <table className="data">
          <thead>
            <tr>
              <th>{t('code')}</th>
              <th>{t('rule')}</th>
              <th>{t('whoIsBlocked')}</th>
              <th>{t('appliesTo')}</th>
              <th>{t('state')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <tr key={rule.code}>
                <td>{rule.code}</td>
                {/* Arabic is the language the rule was written in; English is
                    the translation beside it, not the other way round. */}
                <td style={{ maxWidth: 420 }}>
                  <div dir="rtl">{rule.titleAr}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {rule.titleEn}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {rule.originatingAction} → {rule.blockedAction}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {rule.entityTypes.length ? rule.entityTypes.join(', ') : '—'}
                </td>
                <td>
                  {rule.enforced ? (
                    <span className="badge badge-success">{t('enforced')}</span>
                  ) : (
                    <span className="badge badge-warning">
                      {t('awaiting', { release: rule.awaitingRelease ?? '—' })}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {data.rules.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('trailTitle')}</h2>
        <p className="muted">{t('trailBody')}</p>
      </div>
    </>
  );
}
