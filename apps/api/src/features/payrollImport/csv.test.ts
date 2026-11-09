import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const result = parseCsv('a,b\n1,2\n3,4\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.headers, ['a', 'b']);
    assert.deepEqual(result.rows, [
      { rowNumber: 1, values: ['1', '2'] },
      { rowNumber: 2, values: ['3', '4'] },
    ]);
  });

  it('strips a BOM and handles CRLF', () => {
    const result = parseCsv('\uFEFFa,b\r\nx,y\r\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.headers, ['a', 'b']);
    assert.deepEqual(result.rows[0].values, ['x', 'y']);
  });

  it('keeps commas, quotes, and newlines inside quoted fields', () => {
    const result = parseCsv('a,b\n"one, two","say ""hi""\nnext"\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.rows[0].values, ['one, two', 'say "hi"\nnext']);
  });

  it('skips blank lines and trailing newlines', () => {
    const result = parseCsv('a,b\n\n1,2\n\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
  });

  it('rejects an unclosed quote', () => {
    const result = parseCsv('a,b\n"1,2\n');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /quote/i);
  });

  it('raises a row number for the unclosed quote error', () => {
    const result = parseCsv('a,b\n1,2\n"oops\n');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rowNumber, 2);
  });

  it('returns no rows for a header-only file', () => {
    const result = parseCsv('a,b\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.rows, []);
  });
});
