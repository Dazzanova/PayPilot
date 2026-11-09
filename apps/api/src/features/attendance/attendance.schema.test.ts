import test from 'node:test';
import assert from 'node:assert/strict';
import { attendancePunchSchema, attendanceUpsertSchema } from './attendance.schema';

test('attendancePunchSchema accepts clock in', () => {
  const result = attendancePunchSchema.safeParse({ action: 'in' });
  assert.equal(result.success, true);
});

test('attendancePunchSchema rejects invalid action', () => {
  const result = attendancePunchSchema.safeParse({ action: 'break' });
  assert.equal(result.success, false);
});

test('attendanceUpsertSchema rejects checkout before checkin', () => {
  const result = attendanceUpsertSchema.safeParse({
    employeeId: '00000000-0000-0000-0000-000000000001',
    workDate: '2026-11-08',
    status: 'PRESENT',
    checkInTime: '2026-11-08T10:00:00.000Z',
    checkOutTime: '2026-11-08T09:00:00.000Z',
  });
  assert.equal(result.success, false);
});

test('attendance schemas reject impossible calendar dates', () => {
  assert.equal(attendancePunchSchema.safeParse({ action: 'in', workDate: '2026-02-30' }).success, false);
  assert.equal(
    attendanceUpsertSchema.safeParse({
      employeeId: '00000000-0000-0000-0000-000000000001',
      workDate: '2026-13-01',
      status: 'PRESENT',
    }).success,
    false
  );
});
