import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

/**
 * A placeholder, not a feature.
 *
 * The AI module exists in the API — a provider interface, a router, a memory
 * service, a suggestion service — and is switched off because nobody has
 * decided the one thing that determines whether it may run at all: can this
 * content leave the network to reach a cloud provider, or must the model run
 * on Afro's own infrastructure. Building a chat box in front of a disabled
 * router would let a user type a question into it and receive silence, which
 * is a worse experience than a screen that says plainly what is being waited
 * on. This page is that screen, and it is meant to be replaced the day the
 * decision arrives — not extended.
 */
export default async function AiPlaceholderPage() {
  const t = await getTranslations('aiPlaceholder');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <div className="panel">
        <div className="readiness not-ok">
          <strong>{t('waitingTitle')}</strong>
          <span>{t('waitingBody')}</span>
        </div>

        <ul style={{ fontSize: 13, lineHeight: 1.9, paddingInlineStart: 18, marginTop: 14 }}>
          <li>{t('built')}</li>
          <li>{t('blocked')}</li>
          <li>{t('next')}</li>
        </ul>
      </div>
    </>
  );
}
