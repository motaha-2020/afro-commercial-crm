import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads CRLF the same as LF, because Excel writes CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma that lives inside a quoted field', () => {
    // The case that breaks every split(',') implementation, and the reason
    // this parser exists: company names have commas in them.
    expect(parseCsv('name,country\n"Orange Egypt, S.A.E.",EG')).toEqual([
      ['name', 'country'],
      ['Orange Egypt, S.A.E.', 'EG'],
    ]);
  });

  it('keeps a newline that lives inside a quoted field', () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([['a'], ['line one\nline two']]);
  });

  it('turns a doubled quote into one literal quote', () => {
    expect(parseCsv('a\n"He said ""go"""')).toEqual([['a'], ['He said "go"']]);
  });

  it('strips a byte-order mark so the first header still matches', () => {
    // Without this the column reads as "<U+FEFF>name" and silently matches nothing.
    expect(parseCsv('﻿name,country\nx,EG')[0]).toEqual(['name', 'country']);
  });

  it('drops blank padding rows rather than reporting them as empty records', () => {
    expect(parseCsv('a,b\n1,2\n\n,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a last row that has no trailing newline', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']]);
  });
});

describe('toCsv', () => {
  it('leads with a BOM so Excel on Windows reads it as UTF-8', () => {
    expect(toCsv([['name']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('quotes only the cells that need it', () => {
    expect(toCsv([['plain', 'has,comma', 'has"quote']])).toContain(
      'plain,"has,comma","has""quote"',
    );
  });

  it('survives a round trip with the awkward cells intact', () => {
    const rows = [
      ['name', 'note'],
      ['Orange Egypt, S.A.E.', 'said "yes"\nthen left'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
