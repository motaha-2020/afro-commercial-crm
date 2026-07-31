import { getTranslations } from 'next-intl/server';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const t = await getTranslations('login');
  const app = await getTranslations('app');

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{app('name')}</h1>
        <p>{t('subtitle')}</p>
        <LoginForm />
      </div>
    </div>
  );
}
