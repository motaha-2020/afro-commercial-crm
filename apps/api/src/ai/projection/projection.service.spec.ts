import { project } from './projection.service';

const row = (code: string, note = '') => ({ code, name: `فرصة ${code}`, note });

describe('project', () => {
  it('reports returned, total and truncated honestly when everything fits', () => {
    const result = project([row('OPP-1'), row('OPP-2')], {
      view: (r) => ({ code: r.code }),
      facts: { count: 2 },
    });

    expect(result.returned).toBe(2);
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.note).toBeUndefined();
  });

  it('caps by characters, not by row count', () => {
    // Same row count, very different payload size — a row cap would let the
    // second call through at more than ten times the width.
    const narrow = Array.from({ length: 15 }, (_, i) => row(`OPP-${i}`));
    const wide = Array.from({ length: 15 }, (_, i) => row(`OPP-${i}`, 'x'.repeat(400)));

    const view = (r: { code: string; note: string }) => ({ code: r.code, note: r.note });
    const budget = 2000;

    const narrowResult = project(narrow, { view, facts: {}, charBudget: budget });
    const wideResult = project(wide, { view, facts: {}, charBudget: budget });

    expect(narrowResult.truncated).toBe(false);
    expect(wideResult.truncated).toBe(true);
    expect(wideResult.returned).toBeLessThan(narrowResult.returned);
    expect(JSON.stringify(wideResult.items).length).toBeLessThanOrEqual(budget + 500);
  });

  it('says in the note how much was withheld', () => {
    const result = project(Array.from({ length: 40 }, (_, i) => row(`OPP-${i}`, 'y'.repeat(300))), {
      view: (r) => ({ code: r.code, note: r.note }),
      facts: {},
      charBudget: 1000,
    });

    expect(result.truncated).toBe(true);
    expect(result.note).toContain(`${result.returned} من 40`);
  });

  it('emits one row even when that row alone exceeds the budget', () => {
    const result = project([row('OPP-1', 'z'.repeat(5000))], {
      view: (r) => ({ code: r.code, note: r.note }),
      facts: {},
      charBudget: 100,
    });

    // An empty items array would read as "no data in the system", which is a
    // different claim from "the row did not fit".
    expect(result.returned).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('passes facts through untouched — it never computes them', () => {
    const facts = { withPricing: 3, withoutPricing: 2, notReadable: 1 };
    expect(project([], { view: (r) => r, facts }).facts).toEqual(facts);
  });
});
