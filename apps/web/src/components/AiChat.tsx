'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Built on the server from the evidence ledger, not from the model's words. */
  sources?: string;
  flagged?: boolean;
  failed?: boolean;
}

/**
 * The assistant's surface. It renders what the server decided and adds
 * nothing: the sources line, the flagged marker and the failure marker all
 * arrive as fields, because a client that inferred them would be guessing at
 * exactly the things the server exists to establish.
 */
export function AiChat() {
  const t = useTranslations('ai');

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;

    setTurns((prev) => [...prev, { role: 'user', text: message }]);
    setDraft('');
    setBusy(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId: conversationId.current }),
      });
      const data = await res.json();

      if (!res.ok) {
        // An error from the API is reported as a failure, never dressed up as
        // an answer that happens to be empty.
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', text: data?.message ?? t('failed'), failed: true },
        ]);
        return;
      }

      conversationId.current = data.conversationId;
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.answer,
          sources: data.sources,
          flagged: data.flagged,
          failed: data.failed,
        },
      ]);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: t('failed'), failed: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel ai-chat">
      <div className="ai-turns">
        {turns.length === 0 && <p className="muted">{t('empty')}</p>}

        {turns.map((turn, index) => (
          <div key={index} className={`ai-turn ai-turn-${turn.role}`}>
            <div className="ai-bubble" style={turn.failed ? { opacity: 0.85 } : undefined}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</span>
            </div>
            {turn.sources && <div className="ai-sources">{turn.sources}</div>}
            {turn.flagged && <div className="ai-sources">{t('flagged')}</div>}
          </div>
        ))}

        {busy && <p className="muted">{t('thinking')}</p>}
      </div>

      <form onSubmit={send} className="ai-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('placeholder')}
          maxLength={2000}
          disabled={busy}
        />
        <button type="submit" disabled={busy || draft.trim().length === 0}>
          {t('send')}
        </button>
      </form>
    </div>
  );
}
