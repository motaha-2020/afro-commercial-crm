import { getTranslations } from 'next-intl/server';
import {
  SkeletonPageHead,
  SkeletonScreen,
  SkeletonTable,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={1} />
      <SkeletonTable rows={8} cols={4} />
    </SkeletonScreen>
  );
}
