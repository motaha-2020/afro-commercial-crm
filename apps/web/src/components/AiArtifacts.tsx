'use client';

import { useTranslations } from 'next-intl';

/** Mirrors TurnArtifact on the API. Built by tools, never parsed from prose. */
export type TurnArtifact =
  | { kind: 'report'; filename: string; url: string; rowCount: number; sizeBytes?: number }
  | {
      kind: 'proposal';
      action: string;
      targetCode: string;
      changes: { field: string; value: unknown }[];
      expiresAt: string;
    };

/**
 * The parts of an answer that are things rather than sentences.
 *
 * Every value here came back from a tool. Nothing on this card is read out of
 * the model's text, which is why the download link cannot point at a host the
 * model invented and the proposed fields cannot disagree with what was stored.
 */
export function AiArtifacts({
  artifacts,
  onConfirm,
}: {
  artifacts: TurnArtifact[];
  onConfirm: (code: string) => void;
}) {
  if (artifacts.length === 0) return null;

  return (
    <div className="ai-artifacts">
      {artifacts.map((artifact, i) =>
        artifact.kind === 'report' ? (
          <ReportCard key={i} artifact={artifact} />
        ) : (
          <ProposalCard key={i} artifact={artifact} onConfirm={onConfirm} />
        ),
      )}
    </div>
  );
}

function ReportCard({ artifact }: { artifact: Extract<TurnArtifact, { kind: 'report' }> }) {
  const t = useTranslations('ai');
  return (
    <div className="ai-card">
      <div className="ai-card-head">
        <strong>{artifact.filename}</strong>
        <span>{t('rowCount', { n: artifact.rowCount })}</span>
      </div>
      {/* A real anchor to a path the server produced, so the browser supplies
          the origin. The model has no host to offer and once invented one. */}
      <a className="ai-card-action" href={artifact.url} download>
        {t('download')}
      </a>
    </div>
  );
}

function ProposalCard({
  artifact,
  onConfirm,
}: {
  artifact: Extract<TurnArtifact, { kind: 'proposal' }>;
  onConfirm: (code: string) => void;
}) {
  const t = useTranslations('ai');

  return (
    <div className="ai-card ai-card-warn">
      <div className="ai-card-head">
        <strong>{artifact.action}</strong>
        <span className="ai-code">{artifact.targetCode}</span>
      </div>

      {/* Field by field, from the stored proposal. Approving a sentence is not
          approving the request: a tender labelled Sudan once passed review
          under a summary that read perfectly, carrying country "EG". */}
      <dl className="ai-card-fields">
        {artifact.changes.map((change, i) => (
          <div key={i}>
            <dt>{change.field}</dt>
            <dd>{String(change.value)}</dd>
          </div>
        ))}
      </dl>

      <p className="ai-card-note">{t('confirmHint')}</p>

      <form
        className="ai-card-confirm"
        onSubmit={(event) => {
          event.preventDefault();
          const input = new FormData(event.currentTarget).get('code');
          const code = String(input ?? '').trim();
          if (/^\d{4}$/.test(code)) onConfirm(code);
        }}
      >
        <input
          name="code"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="0000"
          aria-label={t('confirmHint')}
        />
        {/* The code is still typed. The button only saves reaching for the
            composer -- it never carries the code by itself, because a button
            that confirms on its own is not a confirmation. */}
        <button type="submit">{t('confirm')}</button>
      </form>
    </div>
  );
}
