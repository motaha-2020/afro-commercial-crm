import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('app');

  return (
    <main style={{ padding: '64px 24px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>{t('name')}</h1>
      <p style={{ color: 'var(--muted)' }}>{t('tagline')}</p>
    </main>
  );
}
