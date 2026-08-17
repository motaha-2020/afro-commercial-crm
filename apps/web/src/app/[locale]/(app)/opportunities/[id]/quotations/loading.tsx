import { getTranslations } from 'next-intl/server';
import {
  SkeletonPageHead,
  SkeletonPanel,
  SkeletonScreen,
  SkeletonTable,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={2} />
      <SkeletonTable rows={6} cols={6} />
      <SkeletonPanel lines={4} />
    </SkeletonScreen>
  );
}
