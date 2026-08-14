'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';

export function LoginForm() {
  const t = useTranslations('login');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(t('invalid'));
        setLoading(false);
        return;
      }
      // Full document navigation, not router.push: a client-side push would
      // serve the dashboard from the App Router cache populated under the
      // previous session, showing the old user until a manual refresh. A hard
      // load guarantees every server component re-reads the new session cookie.
      window.location.assign(`/${locale}/dashboard`);
    } catch {
      setError(t('invalid'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="login-error">{error}</div>}
      <div className="field">
        <label htmlFor="email">{t('email')}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label htmlFor="password">{t('password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
        {loading ? t('signingIn') : t('signIn')}
      </button>
    </form>
  );
}
