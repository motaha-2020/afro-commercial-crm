import { getTranslations } from 'next-intl/server';
import {
  SkeletonDetail,
  SkeletonScreen,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonDetail panels={2} />
    </SkeletonScreen>
  );
}
