import {
  applicableTaxRules,
  computeTaxes,
  TAX_BASES,
  TAX_TYPES,
  type TaxBaseAmounts,
  type TaxRule,
} from './tax-rules';

const NOW = new Date('2026-08-01T00:00:00.000Z');

const rule = (over: Partial<TaxRule> = {}): TaxRule => ({
  id: 'r1',
  name: 'VAT',
  taxType: 'VAT',
  base: 'SELLING_PRICE',
  ratePercent: 14,
  isRecoverable: false,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  approvalStatus: 'APPROVED',
  ...over,
});

const amounts = (over: Partial<TaxBaseAmounts> = {}): TaxBaseAmounts => ({
  sellingPrice: 1_000_000,
  directCost: 700_000,
  subcontractorPayments: 200_000,
  importedMaterials: 300_000,
  ...over,
});

describe('which tax rules are in force', () => {
  it('a draft rule is a proposal and never reaches a bid', () => {
    const rules = [rule({ approvalStatus: 'DRAFT' }), rule({ id: 'r2', approvalStatus: 'REJECTED' })];
    expect(applicableTaxRules(rules, { asOf: NOW })).toEqual([]);
  });

  it('last year rate is not this year rate', () => {
    const expired = rule({ effectiveTo: '2026-06-30T00:00:00.000Z' });
    expect(applicableTaxRules([expired], { asOf: NOW })).toEqual([]);
  });

  it('a country rule replaces the group rule rather than stacking on it', () => {
    // Both charged would be 24% VAT on the same invoice, which is not a stricter
    // reading of the rules — it is a wrong number.
    const group = rule({ id: 'group', ratePercent: 14 });
    const egypt = rule({ id: 'egypt', ratePercent: 10, country: 'EG' });

    const inForce = applicableTaxRules([group, egypt], { country: 'EG', asOf: NOW });
    expect(inForce.map((r) => r.id)).toEqual(['egypt']);
  });

  it('and the country rule does not leak into another country', () => {
    const egypt = rule({ id: 'egypt', country: 'EG' });
    expect(applicableTaxRules([egypt], { country: 'KE', asOf: NOW })).toEqual([]);
  });
});

describe('what each tax is charged on', () => {
  it('every base is reachable — no base silently reads as zero', () => {
    // An exhaustive sweep: a base added later without a case in basisFor would
    // otherwise fail as "no tax due", which is the one direction this must
    // never fail in.
    for (const base of TAX_BASES) {
      const result = computeTaxes([rule({ base })], amounts(), { asOf: NOW });
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].basis).toBeGreaterThan(0);
    }
  });

  it('withholding is taken from what the subcontractor is paid, not from the deal', () => {
    const wht = rule({ taxType: 'WITHHOLDING', base: 'SUBCONTRACTOR_PAYMENTS', ratePercent: 5 });
    const result = computeTaxes([wht], amounts(), { asOf: NOW });
    expect(result.applied[0].basis).toBe(200_000);
    expect(result.applied[0].amount).toBe(10_000);
  });

  it('a base that is not in this costing is skipped, not charged as zero', () => {
    // "0" reads as considered-and-nothing-due; skipped reads as not applicable,
    // and only one of those is true when there are no imports at all.
    const duty = rule({ taxType: 'CUSTOMS_DUTY', base: 'IMPORTED_MATERIALS', ratePercent: 20 });
    const result = computeTaxes([duty], amounts({ importedMaterials: 0 }), { asOf: NOW });

    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toBe('NO_IMPORTED_MATERIALS');
    expect(result.total).toBe(0);
  });
});

describe('what the project actually bears', () => {
  it('recoverable tax is charged but not borne', () => {
    // The distinction the whole model exists for: VAT the company reclaims is
    // money passing through, and counting it as cost makes a healthy margin
    // look thin.
    const recoverable = rule({ id: 'vat-in', base: 'DIRECT_COST', ratePercent: 14, isRecoverable: true });
    const borneRule = rule({
      id: 'wht',
      taxType: 'WITHHOLDING',
      base: 'SUBCONTRACTOR_PAYMENTS',
      ratePercent: 5,
      isRecoverable: false,
    });

    const result = computeTaxes([recoverable, borneRule], amounts(), { asOf: NOW });

    expect(result.total).toBe(98_000 + 10_000);
    expect(result.borne).toBe(10_000);
  });

  it('totals are grouped by type so an invoice can be reconciled line by line', () => {
    const rules = [
      rule({ id: 'a', base: 'SELLING_PRICE', ratePercent: 14 }),
      rule({ id: 'b', taxType: 'STAMP_DUTY', base: 'SELLING_PRICE', ratePercent: 1 }),
    ];
    const result = computeTaxes(rules, amounts(), { asOf: NOW });

    expect(result.byType).toEqual({ VAT: 140_000, STAMP_DUTY: 10_000 });
  });

  it('every declared type is a real option', () => {
    expect(TAX_TYPES).toContain('VAT');
    expect(TAX_TYPES).toContain('WITHHOLDING');
    expect(new Set(TAX_TYPES).size).toBe(TAX_TYPES.length);
  });
});
