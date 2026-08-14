import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { ProfileForm, type Profile } from '@/components/ProfileForm';

export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('profile');
  const token = await getAccessToken();
  const profile = await apiFetch<Profile>('/auth/profile', { token });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>
      <ProfileForm profile={profile} locale={locale} />
    </>
  );
}
