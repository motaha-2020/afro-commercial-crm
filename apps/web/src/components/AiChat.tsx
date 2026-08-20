'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AiAnswer } from './AiAnswer';
import { AiArtifacts, type TurnArtifact } from './AiArtifacts';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Built on the server from the evidence ledger, not from the model's words. */
  sources?: string;
  flagged?: boolean;
  failed?: boolean;
  /** Things to act on — a file, a change awaiting a code. Never parsed from text. */
  artifacts?: TurnArtifact[];
}

/**
 * The assistant's surface. It renders what the server decided and adds
 * nothing: the sources line, the flagged marker, the failure marker and every
 * control all arrive as fields, because a client that inferred them would be
 * guessing at exactly the things the server exists to establish.
 */
export function AiChat() {
  const t = useTranslations('ai');

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  // A new answer that lands below the fold reads as no answer at all.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function send(message: string) {
    if (!message || busy) return;

    setTurns((prev) => [...prev, { role: 'user', text: message }]);
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
          artifacts: data.artifacts ?? [],
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
              {turn.role === 'assistant' ? (
                <AiAnswer text={turn.text} />
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</span>
              )}
            </div>

            {turn.artifacts && turn.artifacts.length > 0 && (
              // Confirming sends the code as an ordinary message, so it takes
              // the same deterministic path as one typed into the composer.
              <AiArtifacts artifacts={turn.artifacts} onConfirm={(code) => void send(code)} />
            )}

            {turn.sources && <div className="ai-sources">{turn.sources}</div>}
            {turn.flagged && <div className="ai-sources">{t('flagged')}</div>}
          </div>
        ))}

        {busy && <p className="muted">{t('thinking')}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          setDraft('');
          void send(message);
        }}
      >
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
