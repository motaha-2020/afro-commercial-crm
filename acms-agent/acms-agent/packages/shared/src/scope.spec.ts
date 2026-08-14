import { scopeReadiness } from './scope';

const base = {
  packages: 3,
  items: 12,
  unconfirmedAssumptions: 0,
  openClarifications: 0,
  blockingClarifications: 0,
};

describe('scope readiness', () => {
  it('is ready with packages, items and nothing blocking', () => {
    expect(scopeReadiness(base).ready).toBe(true);
  });

  it('is not ready with an empty scope', () => {
    expect(scopeReadiness({ ...base, packages: 0 }).ready).toBe(false);
    expect(scopeReadiness({ ...base, items: 0 }).ready).toBe(false);
  });

  it('a single blocking clarification makes it not ready', () => {
    // Not a proportion: 11 of 12 answers is no comfort when the twelfth
    // decides the price.
    expect(scopeReadiness({ ...base, openClarifications: 1, blockingClarifications: 1 }).ready)
      .toBe(false);
  });

  it('non-blocking open questions do not stop the bid', () => {
    expect(scopeReadiness({ ...base, openClarifications: 4 }).ready).toBe(true);
  });

  it('reports the counts so the verdict is never a bare number', () => {
    const r = scopeReadiness({ ...base, unconfirmedAssumptions: 3 });
    expect(r.unconfirmedAssumptions).toBe(3);
    expect(r.items).toBe(12);
  });
});
