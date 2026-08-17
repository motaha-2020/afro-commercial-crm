import { getTranslations } from 'next-intl/server';
import {
  SkeletonKpis,
  SkeletonPageHead,
  SkeletonPanel,
  SkeletonScreen,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={1} />
      <SkeletonKpis count={4} />
      <SkeletonPanel lines={6} />
      <SkeletonPanel lines={4} />
    </SkeletonScreen>
  );
}
