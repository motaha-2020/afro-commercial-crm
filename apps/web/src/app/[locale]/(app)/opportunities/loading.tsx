import { getTranslations } from 'next-intl/server';
import {
  SkeletonBoard,
  SkeletonFilters,
  SkeletonPageHead,
  SkeletonScreen,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={2} />
      <SkeletonFilters fields={5} />
      <SkeletonBoard columns={6} cards={3} />
    </SkeletonScreen>
  );
}
