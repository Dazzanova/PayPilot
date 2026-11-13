import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deductionRuleCreateSchema,
  deductionRuleUpdateSchema,
  payrollRunCreateSchema,
  payrollRunVoidSchema,
} from './payroll.schema';

describe('payrollRunCreateSchema', () => {
  it('accepts a valid period', () => {
    const result = payrollRunCreateSchema.parse({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      payDate: '2026-10-31',
    });
    assert.equal(result.periodStart, '2026-10-01');
  });

  it('rejects a non-calendar date', () => {
    assert.throws(() =>
      payrollRunCreateSchema.parse({
        periodStart: '2026-02-30',
        periodEnd: '2026-03-31',
        payDate: '2026-03-31',
      })
    );
  });

  it('rejects an inverted period', () => {
    assert.throws(() =>
      payrollRunCreateSchema.parse({
        periodStart: '2026-10-31',
        periodEnd: '2026-10-01',
        payDate: '2026-10-31',
      })
    );
  });

  it('rejects a pay date before the period end', () => {
    assert.throws(() =>
      payrollRunCreateSchema.parse({
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        payDate: '2026-10-30',
      })
    );
  });
});

describe('payrollRunVoidSchema', () => {
  it('requires a non-empty reason', () => {
    assert.throws(() => payrollRunVoidSchema.parse({ reason: '   ' }));
    assert.equal(payrollRunVoidSchema.parse({ reason: 'Duplicate run' }).reason, 'Duplicate run');
  });

  it('caps the reason length', () => {
    assert.throws(() => payrollRunVoidSchema.parse({ reason: 'x'.repeat(501) }));
  });
});

describe('deductionRuleCreateSchema', () => {
  it('accepts a rate at or below 100', () => {
    const result = deductionRuleCreateSchema.parse({
      name: 'Income tax',
      type: 'RATE',
      value: 100,
    });
    assert.equal(result.taxable, true);
    assert.equal(result.active, true);
  });

  it('rejects a rate above 100', () => {
    assert.throws(() =>
      deductionRuleCreateSchema.parse({ name: 'Tax', type: 'RATE', value: 101 })
    );
  });

  it('rejects a non-positive fixed value', () => {
    assert.throws(() =>
      deductionRuleCreateSchema.parse({ name: 'Health', type: 'FIXED', value: 0 })
    );
  });
});

describe('deductionRuleUpdateSchema', () => {
  it('accepts a partial update', () => {
    assert.deepEqual(deductionRuleUpdateSchema.parse({ active: false }), { active: false });
  });

  it('rejects a rate above 100 on update', () => {
    assert.throws(() => deductionRuleUpdateSchema.parse({ type: 'RATE', value: 150 }));
  });
});
