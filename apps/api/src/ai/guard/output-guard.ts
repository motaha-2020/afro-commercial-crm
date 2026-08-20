import { EvidenceLedger, RECORD_CODE_PATTERN } from '../evidence/evidence-ledger';

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export interface GuardResult {
  text: string;
  flagged: boolean;
  reasons: string[];
}

/**
 * The last check before an answer reaches a person. A pure function of the
 * answer and the ledger, so it is testable without a model.
 *
 * It caught a real incident: asked to create an opportunity for an account
 * that did not exist, the model invented a well-formed account code belonging
 * to a different company. Well-formed is not the same as delivered, and only
 * the ledger knows the difference.
 */
export function guardOutput(
  answer: string,
  ledger: EvidenceLedger,
  /**
   * The question that was asked. Codes the user typed themselves were, in the
   * plainest sense, given to the model -- by the person reading the answer.
   * Without this, quoting a code back is treated as invention, and the worst
   * casualty is a correct refusal: "OPP-2026-999999 matches no record" got
   * stamped with a fabrication warning about the very code it was rejecting.
   */
  question = '',
): GuardResult {
  const reasons: string[] = [];

  // Internal identifiers are never a user's business, and a leaked one invites
  // being pasted back in as if it were a reference.
  const text = answer.replace(UUID_PATTERN, () => {
    if (!reasons.includes('raw_uuid')) reasons.push('raw_uuid');
    return '[معرّف داخلي محجوب]';
  });

  const askedAbout = new Set(question.match(RECORD_CODE_PATTERN) ?? []);
  const delivered = ledger.codes();
  const unsupported = [...new Set(text.match(RECORD_CODE_PATTERN) ?? [])].filter(
    (code) => !delivered.has(code) && !askedAbout.has(code),
  );

  if (unsupported.length > 0) reasons.push(`unsupported_codes:${unsupported.join(',')}`);

  if (reasons.length === 0) return { text, flagged: false, reasons };

  const warning =
    unsupported.length > 0
      ? `\n\n⚠️ تحذير: الأكواد التالية وردت في الجواب ولم تُسلَّم من أي أداة — لا تعتمد عليها: ${unsupported.join('، ')}`
      : '\n\n⚠️ تحذير: حُجب معرّف داخلي من هذا الجواب.';

  return { text: text + warning, flagged: true, reasons };
}
