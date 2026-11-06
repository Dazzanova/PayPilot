const PREFIX = 'PP-';
const STARTING_SEQUENCE = 1001;
const PATTERN = /^PP-([0-9]+)$/;

export function parseEmployeeNumber(value: string): number | null {
  const match = PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatEmployeeNumber(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid employee number sequence: ${sequence}`);
  }
  return `${PREFIX}${sequence}`;
}

export function nextEmployeeNumber(existing: readonly string[]): string {
  const highest = existing.reduce((max, value) => {
    const parsed = parseEmployeeNumber(value);
    return parsed !== null && parsed > max ? parsed : max;
  }, STARTING_SEQUENCE - 1);

  return formatEmployeeNumber(Math.max(highest + 1, STARTING_SEQUENCE));
}
