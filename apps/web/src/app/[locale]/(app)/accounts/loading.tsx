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
      <SkeletonPageHead actions={3} />
      <SkeletonFilters fields={3} />
      <SkeletonTable rows={8} cols={8} />
    </SkeletonScreen>
  );
}
