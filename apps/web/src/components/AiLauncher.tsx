'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AiChat } from './AiChat';

/**
 * The assistant lives over every screen rather than on one of its own.
 *
 * The questions it answers are about whatever the user is already looking at,
 * so sending them to a separate page to ask means leaving the thing they meant
 * to ask about.
 *
 * The panel is hidden rather than unmounted while closed. Closing it to look
 * at a record and reopening it to ask the next question is the normal way to
 * use it, and unmounting would drop the conversation every time.
 */
export function AiLauncher() {
  const t = useTranslations('ai');
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  // Escape closes it. A floating panel with no keyboard exit traps anyone who
  // opened it by accident, keyboard and screen-reader users worst of all.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector('input')?.focus();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="ai-fab"
        aria-expanded={open}
        aria-label={open ? t('close') : t('open')}
        title={t('open')}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : '✦'}
      </button>

      {/* Not rendered at all until first opened, so a user who never asks
          anything pays nothing for it; kept mounted thereafter. */}
      {everOpened && (
        <div
          className="ai-dock"
          ref={panelRef}
          role="dialog"
          aria-label={t('title')}
          hidden={!open}
        >
          <div className="ai-dock-head">
            <strong>{t('title')}</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label={t('close')}>
              ×
            </button>
          </div>
          <AiChat />
        </div>
      )}
    </>
  );
}
