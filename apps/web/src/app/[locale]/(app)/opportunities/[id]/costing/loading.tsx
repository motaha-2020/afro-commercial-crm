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
      <SkeletonPanel lines={3} />
      <SkeletonTable rows={10} cols={7} />
    </SkeletonScreen>
  );
}
