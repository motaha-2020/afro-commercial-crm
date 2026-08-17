import { getTranslations } from 'next-intl/server';
import {
  SkeletonForm,
  SkeletonPageHead,
  SkeletonScreen,
} from '@/components/Skeleton';

export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <SkeletonScreen label={t('loading')}>
      <SkeletonPageHead actions={0} />
      <SkeletonForm fields={5} />
    </SkeletonScreen>
  );
}
