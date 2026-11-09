import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveCreateSchema, leaveReviewSchema } from './leave.schema';

test('leaveCreateSchema accepts valid request', () => {
  const result = leaveCreateSchema.safeParse({
    leaveType: 'ANNUAL',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    reason: 'Family trip',
  });
  assert.equal(result.success, true);
});

test('leaveCreateSchema rejects end before start', () => {
  const result = leaveCreateSchema.safeParse({
    leaveType: 'SICK',
    startDate: '2026-11-12',
    endDate: '2026-11-10',
    reason: 'Sick',
  });
  assert.equal(result.success, false);
});

test('leaveReviewSchema accepts approve/reject', () => {
  assert.equal(leaveReviewSchema.safeParse({ action: 'approve' }).success, true);
  assert.equal(leaveReviewSchema.safeParse({ action: 'reject' }).success, true);
  assert.equal(leaveReviewSchema.safeParse({ action: 'cancel' }).success, false);
});

test('leaveCreateSchema rejects impossible calendar dates', () => {
  const result = leaveCreateSchema.safeParse({
    leaveType: 'ANNUAL',
    startDate: '2026-02-30',
    endDate: '2026-03-02',
    reason: 'Family trip',
  });
  assert.equal(result.success, false);
});
