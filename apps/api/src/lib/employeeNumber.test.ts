import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEmployeeNumber,
  nextEmployeeNumber,
  parseEmployeeNumber,
} from './employeeNumber';

describe('employeeNumber', () => {
  it('parses a formatted number', () => {
    assert.equal(parseEmployeeNumber('PP-1001'), 1001);
    assert.equal(parseEmployeeNumber(' PP-42 '), 42);
  });

  it('returns null for values outside the format', () => {
    assert.equal(parseEmployeeNumber('TEMP-1001'), null);
    assert.equal(parseEmployeeNumber('PP-XYZ'), null);
    assert.equal(parseEmployeeNumber('PP-'), null);
    assert.equal(parseEmployeeNumber('1001'), null);
  });

  it('formats a sequence', () => {
    assert.equal(formatEmployeeNumber(1001), 'PP-1001');
    assert.equal(formatEmployeeNumber(7), 'PP-7');
  });

  it('rejects invalid sequences', () => {
    assert.throws(() => formatEmployeeNumber(0));
    assert.throws(() => formatEmployeeNumber(-1));
    assert.throws(() => formatEmployeeNumber(1.5));
  });

  it('starts at PP-1001 for an empty organization', () => {
    assert.equal(nextEmployeeNumber([]), 'PP-1001');
  });

  it('increments past the highest matching number', () => {
    assert.equal(nextEmployeeNumber(['PP-1001', 'PP-1003', 'PP-1002']), 'PP-1004');
  });

  it('ignores values that do not match the format', () => {
    assert.equal(nextEmployeeNumber(['TEMP-5', 'PP-XYZ', 'PP-1001']), 'PP-1002');
  });

  it('never drops below the starting number', () => {
    assert.equal(nextEmployeeNumber(['PP-4']), 'PP-1001');
  });
});
