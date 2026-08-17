import { getTranslations } from 'next-intl/server';
import {
  SkeletonFilters,
  SkeletonPageHead,
  SkeletonScreen,
  SkeletonTable,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={1} />
      <SkeletonFilters fields={4} />
      <SkeletonTable rows={8} cols={6} />
    </SkeletonScreen>
  );
}
