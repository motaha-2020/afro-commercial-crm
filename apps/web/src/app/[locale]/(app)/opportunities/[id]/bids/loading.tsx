import { getTranslations } from 'next-intl/server';
import {
  SkeletonPageHead,
  SkeletonPanel,
  SkeletonScreen,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={1} />
      <SkeletonPanel lines={5} />
      <SkeletonPanel lines={8} />
    </SkeletonScreen>
  );
}
