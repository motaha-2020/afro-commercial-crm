'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface Profile {
  id: string;
  email: string;
  fullNameAr: string;
  fullNameEn: string;
  jobTitle?: string | null;
  phone?: string | null;
  locale?: string | null;
  avatarUrl?: string | null;
  mustChangePassword: boolean;
  orgUnit?: { code: string; nameAr: string; nameEn: string } | null;
  roles: { role: string; scope: string }[];
}

function errText(e: unknown): string {
  const m = (e as { message?: string | string[] })?.message;
  return Array.isArray(m) ? m.join(' · ') : (m ?? 'Error');
}

/** Downscales an image to a square ~256px data URL so an avatar stays small
 *  enough to store inline without a separate upload service. */
function resizeToDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas'));
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfileForm({ profile, locale }: { profile: Profile; locale: string }) {
  const t = useTranslations('profile');
  const router = useRouter();
  const ar = locale === 'ar';
  const fileRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState({
    fullNameAr: profile.fullNameAr,
    fullNameEn: profile.fullNameEn,
    jobTitle: profile.jobTitle ?? '',
    phone: profile.phone ?? '',
  });
  const [avatar, setAvatar] = useState<string | null>(profile.avatarUrl ?? null);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const initials = (ar ? profile.fullNameAr : profile.fullNameEn)
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0])
    .join('');

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
      });
      if (!res.ok) throw await res.json();
      setInfoMsg({ ok: true, text: t('saved') });
      router.refresh();
    } catch (err) {
      setInfoMsg({ ok: false, text: errText(err) });
    } finally {
      setSavingInfo(false);
    }
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setInfoMsg(null);
    try {
      const dataUrl = await resizeToDataUrl(file);
      setAvatar(dataUrl);
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });
      if (!res.ok) throw await res.json();
      setInfoMsg({ ok: true, text: t('avatarSaved') });
      router.refresh();
    } catch (err) {
      setInfoMsg({ ok: false, text: errText(err) });
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.newPassword !== pw.confirm) {
      setPwMsg({ ok: false, text: t('mismatch') });
      return;
    }
    if (pw.newPassword.length < 10) {
      setPwMsg({ ok: false, text: t('tooShort') });
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
      });
      if (!res.ok) throw await res.json();
      setPwMsg({ ok: true, text: t('pwChanged') });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      router.refresh();
    } catch (err) {
      setPwMsg({ ok: false, text: errText(err) });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      {profile.mustChangePassword && (
        <div className="panel" style={{ borderColor: 'var(--warn, #b57612)', background: 'var(--warn-soft, #fbf1de)' }}>
          <strong>{t('mustChangeTitle')}</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('mustChangeHint')}</p>
        </div>
      )}

      {/* Identity + avatar */}
      <div className="panel">
        <h2>{t('accountTitle')}</h2>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 16 }}>
          <div
            style={{
              width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
              background: 'var(--primary-soft)', color: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 700,
            }}
          >
            {avatar ? (
              <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              {t('changePhoto')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickAvatar}
              style={{ display: 'none' }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('photoHint')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span className="badge badge-info" style={{ direction: 'ltr' }}>{profile.email}</span>
          {profile.roles.map((r) => (
            <span key={r.role} className="badge badge-primary">{r.role}@{r.scope}</span>
          ))}
          {profile.orgUnit && (
            <span className="badge">{ar ? profile.orgUnit.nameAr : profile.orgUnit.nameEn}</span>
          )}
        </div>
      </div>

      {/* Editable info */}
      <div className="panel">
        <h2>{t('detailsTitle')}</h2>
        {infoMsg && (
          <div className={infoMsg.ok ? 'badge badge-success' : 'form-error'} style={{ marginBottom: 12, display: 'inline-block' }}>
            {infoMsg.text}
          </div>
        )}
        <form onSubmit={saveInfo}>
          <div className="form-grid">
            <label className="field">
              <span>{t('nameAr')}</span>
              <input value={info.fullNameAr} onChange={(e) => setInfo({ ...info, fullNameAr: e.target.value })} required />
            </label>
            <label className="field">
              <span>{t('nameEn')}</span>
              <input value={info.fullNameEn} onChange={(e) => setInfo({ ...info, fullNameEn: e.target.value })} required />
            </label>
            <label className="field">
              <span>{t('jobTitle')}</span>
              <input value={info.jobTitle} onChange={(e) => setInfo({ ...info, jobTitle: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('phone')}</span>
              <input value={info.phone} onChange={(e) => setInfo({ ...info, phone: e.target.value })} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingInfo}>
                {savingInfo ? t('saving') : t('saveInfo')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Change password */}
      <div className="panel">
        <h2>{t('passwordTitle')}</h2>
        {pwMsg && (
          <div className={pwMsg.ok ? 'badge badge-success' : 'form-error'} style={{ marginBottom: 12, display: 'inline-block' }}>
            {pwMsg.text}
          </div>
        )}
        <form onSubmit={changePassword}>
          <div className="form-grid">
            <label className="field wide">
              <span>{t('currentPassword')}</span>
              <input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required autoComplete="current-password" />
            </label>
            <label className="field">
              <span>{t('newPassword')}</span>
              <input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required autoComplete="new-password" />
            </label>
            <label className="field">
              <span>{t('confirmPassword')}</span>
              <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingPw}>
                {savingPw ? t('saving') : t('changePassword')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
