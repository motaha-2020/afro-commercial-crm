import { getTranslations } from 'next-intl/server';
import { SkeletonPageHead, SkeletonPanel, SkeletonScreen } from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead />
      <SkeletonPanel lines={3} />
      <SkeletonPanel lines={6} />
    </SkeletonScreen>
  );
}
