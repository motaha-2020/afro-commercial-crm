import { EvidenceLedger } from '../evidence/evidence-ledger';
import { guardOutput } from './output-guard';

function ledgerWith(codes: string[]): EvidenceLedger {
  const ledger = new EvidenceLedger();
  ledger.record({
    tool: 'listOpportunities',
    resource: 'الفرص',
    returned: codes.length,
    total: codes.length,
    truncated: false,
    codes,
  });
  return ledger;
}

describe('guardOutput', () => {
  it('passes an answer whose codes were all delivered', () => {
    const result = guardOutput(
      'الفرصة OPP-2026-000289 في مرحلة Bid.',
      ledgerWith(['OPP-2026-000289']),
    );

    expect(result.flagged).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.text).toBe('الفرصة OPP-2026-000289 في مرحلة Bid.');
  });

  it('flags a well-formed code that no tool delivered', () => {
    const result = guardOutput(
      'حسب السجل، ACC-000114 هو الحساب المرتبط.',
      ledgerWith(['OPP-2026-000289']),
    );

    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain('unsupported_codes:ACC-000114');
    expect(result.text).toContain('لم تُسلَّم من أي أداة');
  });

  it('redacts a raw uuid rather than letting it reach the user', () => {
    const result = guardOutput(
      'المعرّف 3f2504e0-4f89-41d3-9a0c-0305e82c3301 يخصّ الفرصة.',
      ledgerWith([]),
    );

    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain('raw_uuid');
    expect(result.text).not.toContain('3f2504e0');
  });

  it('lets the answer quote a code the user themselves typed', () => {
    const result = guardOutput(
      'الكود OPP-2026-999999 لا يقابل أي سجل. لم يُنفَّذ أي تغيير.',
      ledgerWith([]),
      'غيّر مرحلة OPP-2026-999999 إلى Bid',
    );

    // Refusing a code the user supplied is the correct answer; warning that
    // the refusal cites an unsupported code makes the correct answer look
    // suspect.
    expect(result.flagged).toBe(false);
  });

  it('still flags a code the user never mentioned', () => {
    const result = guardOutput(
      'الحساب المرتبط هو ACC-000114.',
      ledgerWith([]),
      'غيّر مرحلة OPP-2026-999999 إلى Bid',
    );

    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain('unsupported_codes:ACC-000114');
  });

  it('treats an empty ledger as delivering nothing, not as permitting everything', () => {
    const result = guardOutput('لديك فرصة واحدة هي OPP-2026-000001.', new EvidenceLedger());
    expect(result.flagged).toBe(true);
  });
});
