import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmploymentType, EmployeeStatus, Prisma } from '@prisma/client';
import {
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeStatusSchema,
  employeeUpdateSchema,
} from './employees.schema';
import { toEmployeeDto } from './employees.dto';

const valid = {
  firstName: 'Alex',
  lastName: 'Mercer',
  email: 'Alex.Mercer@Example.com',
  phone: '+1 (555) 234-5678',
  jobTitle: 'VP of Engineering',
  employmentType: EmploymentType.FULL_TIME,
  joinedAt: '2026-01-15',
  baseSalary: '145000.00',
  departmentId: null,
};

describe('employeeCreateSchema', () => {
  it('normalizes email and phone', () => {
    const parsed = employeeCreateSchema.parse(valid);
    assert.equal(parsed.email, 'alex.mercer@example.com');
    assert.equal(parsed.phone, '+1 (555) 234-5678');
    assert.equal(parsed.baseSalary, '145000.00');
  });

  it('trims phone input', () => {
    const parsed = employeeCreateSchema.parse({ ...valid, phone: '  +1 (555) 234-5678  ' });
    assert.equal(parsed.phone, '+1 (555) 234-5678');
  });

  it('turns an empty phone into null', () => {
    const parsed = employeeCreateSchema.parse({ ...valid, phone: '  ' });
    assert.equal(parsed.phone, null);
  });

  it('rejects unknown keys such as employeeNumber', () => {
    const result = employeeCreateSchema.safeParse({ ...valid, employeeNumber: 'PP-1' });
    assert.equal(result.success, false);
  });

  it('rejects a future joinedAt', () => {
    const result = employeeCreateSchema.safeParse({ ...valid, joinedAt: '2999-01-01' });
    assert.equal(result.success, false);
  });

  it('rejects an invalid calendar date', () => {
    const result = employeeCreateSchema.safeParse({ ...valid, joinedAt: '2026-02-30' });
    assert.equal(result.success, false);
  });

  it('rejects zero, negative, and over-precise salaries', () => {
    for (const baseSalary of ['0', '-10', '1.005', '10000000000']) {
      assert.equal(employeeCreateSchema.safeParse({ ...valid, baseSalary }).success, false);
    }
  });

  it('accepts the salary boundaries', () => {
    for (const baseSalary of ['0.01', '9999999999.99']) {
      const parsed = employeeCreateSchema.safeParse({ ...valid, baseSalary });
      assert.equal(parsed.success, true);
      assert.equal(parsed.success && parsed.data.baseSalary, baseSalary);
    }
  });

  it('rejects empty names and invalid emails', () => {
    assert.equal(employeeCreateSchema.safeParse({ ...valid, firstName: '  ' }).success, false);
    assert.equal(employeeCreateSchema.safeParse({ ...valid, email: 'nope' }).success, false);
  });

  it('rejects an unknown employment type', () => {
    assert.equal(
      employeeCreateSchema.safeParse({ ...valid, employmentType: 'FREELANCE' }).success,
      false
    );
  });

  it('rejects phone numbers that are too long or contain unsupported characters', () => {
    assert.equal(
      employeeCreateSchema.safeParse({ ...valid, phone: '1'.repeat(31) }).success,
      false
    );
    assert.equal(
      employeeCreateSchema.safeParse({ ...valid, phone: 'abc' }).success,
      false
    );
  });

  it('rejects a joinedAt before the minimum date', () => {
    assert.equal(
      employeeCreateSchema.safeParse({ ...valid, joinedAt: '1899-12-31' }).success,
      false
    );
  });
});

describe('employeeUpdateSchema', () => {
  it('accepts a single field', () => {
    assert.deepEqual(employeeUpdateSchema.parse({ jobTitle: 'CTO' }), { jobTitle: 'CTO' });
  });

  it('rejects an empty object and status changes', () => {
    assert.equal(employeeUpdateSchema.safeParse({}).success, false);
    assert.equal(employeeUpdateSchema.safeParse({ status: EmployeeStatus.ACTIVE }).success, false);
  });

  it('rejects server-managed and tenant fields', () => {
    for (const value of [
      { employeeNumber: 'PP-1001' },
      { userId: 'u1' },
      { organizationId: 'o1' },
    ]) {
      assert.equal(employeeUpdateSchema.safeParse(value).success, false);
    }
  });
});

describe('employeeStatusSchema', () => {
  it('accepts a known status', () => {
    assert.deepEqual(employeeStatusSchema.parse({ status: 'ON_LEAVE' }), {
      status: EmployeeStatus.ON_LEAVE,
    });
  });

  it('rejects an unknown status', () => {
    assert.equal(employeeStatusSchema.safeParse({ status: 'RETIRED' }).success, false);
  });
});

describe('employeeListQuerySchema', () => {
  it('applies defaults', () => {
    const parsed = employeeListQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 25);
    assert.equal(parsed.sort, 'lastName');
    assert.equal(parsed.order, 'asc');
  });

  it('clamps page and pageSize instead of rejecting', () => {
    assert.equal(employeeListQuerySchema.parse({ page: '0', pageSize: '500' }).page, 1);
    assert.equal(employeeListQuerySchema.parse({ page: '0', pageSize: '500' }).pageSize, 100);
  });

  it('falls back to defaults for unparseable paging values', () => {
    const parsed = employeeListQuerySchema.parse({ page: 'abc', pageSize: 'abc' });
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 25);
  });

  it('trims search and rejects an invalid department id', () => {
    assert.equal(employeeListQuerySchema.parse({ search: '  alex  ' }).search, 'alex');
    assert.equal(
      employeeListQuerySchema.safeParse({ departmentId: 'not-a-uuid' }).success,
      false
    );
  });

  it('rejects an overlong search term', () => {
    assert.equal(
      employeeListQuerySchema.safeParse({ search: 'a'.repeat(101) }).success,
      false
    );
  });
});

describe('toEmployeeDto', () => {
  it('serializes dates and decimals for the API shape', () => {
    const dto = toEmployeeDto({
      id: 'e1',
      organizationId: 'o1',
      departmentId: 'd1',
      userId: null,
      employeeNumber: 'PP-1001',
      firstName: 'Alex',
      lastName: 'Mercer',
      email: 'alex@example.com',
      phone: null,
      jobTitle: 'VP of Engineering',
      employmentType: EmploymentType.FULL_TIME,
      status: EmployeeStatus.ACTIVE,
      joinedAt: new Date('2026-01-15T00:00:00.000Z'),
      baseSalary: new Prisma.Decimal('145000'),
      state: null,
      pfApplicable: true,
      esiApplicable: true,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-02T10:00:00.000Z'),
      department: {
        id: 'd1',
        organizationId: 'o1',
        name: 'Engineering',
        code: 'ENG',
        description: null,
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
        updatedAt: new Date('2026-01-02T10:00:00.000Z'),
      },
    });

    assert.equal(dto.joinedAt, '2026-01-15');
    assert.equal(dto.baseSalary, '145000.00');
    assert.equal(dto.departmentName, 'Engineering');
    assert.equal(dto.createdAt, '2026-01-01T10:00:00.000Z');
  });

  it('maps a missing department to a null departmentName', () => {
    const dto = toEmployeeDto({
      id: 'e1',
      organizationId: 'o1',
      departmentId: null,
      userId: null,
      employeeNumber: 'PP-1001',
      firstName: 'Alex',
      lastName: 'Mercer',
      email: 'alex@example.com',
      phone: null,
      jobTitle: 'VP of Engineering',
      employmentType: EmploymentType.FULL_TIME,
      status: EmployeeStatus.ACTIVE,
      joinedAt: new Date('2026-01-15T00:00:00.000Z'),
      baseSalary: new Prisma.Decimal('145000'),
      state: null,
      pfApplicable: true,
      esiApplicable: true,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-02T10:00:00.000Z'),
      department: null,
    });

    assert.equal(dto.departmentId, null);
    assert.equal(dto.departmentName, null);
  });
});
