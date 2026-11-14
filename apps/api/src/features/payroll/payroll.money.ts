/**
 * Rounds a number to the nearest integer, with exact halves rounded upward.
 * Payroll money math stays in integer cents, so every division uses this.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
