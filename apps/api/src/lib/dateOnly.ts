const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts only real `YYYY-MM-DD` calendar dates. The regex alone would let
 * values like `2026-02-30` through to Prisma, which would fail as a 500.
 */
export function isDateOnly(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
