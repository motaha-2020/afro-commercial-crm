import { Injectable } from '@nestjs/common';

export type Intent = 'read' | 'change' | 'report' | 'unknown';

export type GateDecision =
  | { kind: 'confirmation'; code: string }
  | { kind: 'route'; intent: Intent };

/** Arabic and English alike — the keyword decides, not the language. */
const CHANGE_WORDS = [
  'غيّر', 'غير ', 'عدّل', 'عدل ', 'حدّث', 'حدث ', 'أنشئ', 'انشئ', 'أضف', 'اضف',
  'احذف', 'امسح', 'انقل', 'وافق', 'اعتمد', 'ارفض', 'خصم',
  'change', 'update', 'create', 'add ', 'delete', 'remove', 'move ', 'approve', 'reject', 'set ',
];

const REPORT_WORDS = [
  'تقرير', 'تقارير', 'ملف', 'تنزيل', 'حمّل', 'حمل ', 'اطبع', 'pdf', 'excel',
  'report', 'download', 'export', 'generate',
];

const READ_WORDS = [
  'كم', 'ما هي', 'ماهي', 'اعرض', 'أعرض', 'أظهر', 'اظهر', 'قائمة', 'من هو', 'متى', 'أين', 'اين',
  'list', 'show', 'how many', 'what', 'which', 'who', 'when', 'where',
];

/**
 * Runs before any model is called, and decides in plain code.
 *
 * A four-digit message is a confirmation for a pending action and must never
 * reach a model — routing that through an LLM would put a write behind a
 * probabilistic step. Everything else gets a keyword-derived intent that is
 * handed to the orchestrator as a *routing suggestion*, not an instruction:
 * keywords are wrong often enough that they may not be the last word.
 */
@Injectable()
export class IntentGateService {
  decide(message: string): GateDecision {
    const trimmed = message.trim();

    const confirmation = /^[\s٠-٩\d]*?(\d{4})[\s]*$/.exec(toWesternDigits(trimmed));
    if (confirmation && toWesternDigits(trimmed).replace(/\s/g, '').length === 4) {
      return { kind: 'confirmation', code: confirmation[1] };
    }

    return { kind: 'route', intent: this.classify(trimmed.toLowerCase()) };
  }

  private classify(lower: string): Intent {
    // Order matters: "أنشئ تقريرًا" is a report request, not a data change,
    // and the report agent writes a file rather than a record.
    if (REPORT_WORDS.some((word) => lower.includes(word))) return 'report';
    if (CHANGE_WORDS.some((word) => lower.includes(word))) return 'change';
    if (READ_WORDS.some((word) => lower.includes(word))) return 'read';
    return 'unknown';
  }
}

/** Arabic-Indic digits are what a user on an Arabic keyboard actually types. */
export function toWesternDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
