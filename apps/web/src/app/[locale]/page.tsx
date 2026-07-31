import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

export default async function LocaleRoot({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getSessionUser();
  redirect(user ? `/${locale}/dashboard` : `/${locale}/login`);
}
