import { IntentGateService } from './intent-gate.service';

describe('IntentGateService', () => {
  const gate = new IntentGateService();

  it('routes a bare four-digit message to confirmation without any model', () => {
    expect(gate.decide('4821')).toEqual({ kind: 'confirmation', code: '4821' });
    expect(gate.decide('  4821  ')).toEqual({ kind: 'confirmation', code: '4821' });
  });

  it('accepts Arabic-Indic digits — that is what an Arabic keyboard types', () => {
    expect(gate.decide('٤٨٢١')).toEqual({ kind: 'confirmation', code: '4821' });
  });

  it('does not mistake a question containing a number for a confirmation', () => {
    expect(gate.decide('كم فرصة لدينا في 2026؟').kind).toBe('route');
    expect(gate.decide('اعرض OPP-2026-000289').kind).toBe('route');
  });

  it('classifies change requests as change', () => {
    expect(gate.decide('غيّر مرحلة OPP-2026-000289 إلى Bid')).toEqual({
      kind: 'route',
      intent: 'change',
    });
    expect(gate.decide('وافق على الخصم')).toEqual({ kind: 'route', intent: 'change' });
  });

  it('classifies read questions as read', () => {
    expect(gate.decide('كم فرصة مفتوحة لدي؟')).toEqual({ kind: 'route', intent: 'read' });
  });

  it('prefers report over change when both words appear', () => {
    // "أنشئ تقريرًا" writes a file, not a record.
    expect(gate.decide('أنشئ تقريرًا بالفرص')).toEqual({ kind: 'route', intent: 'report' });
  });

  it('returns unknown rather than guessing', () => {
    expect(gate.decide('صباح الخير')).toEqual({ kind: 'route', intent: 'unknown' });
  });
});
