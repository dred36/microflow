/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ThicknessUnit = 'nm' | 'um';

export function getUnitLabel(unit: ThicknessUnit): string {
  return unit === 'um' ? 'µm' : 'nm';
}

/**
 * Convert an internal nanometer value to display value in the chosen unit.
 */
export function fromNm(nm: number, unit: ThicknessUnit): number {
  if (!Number.isFinite(nm)) return 0;
  return unit === 'um' ? nm / 1000 : nm;
}

/**
 * Convert a user-entered value in the chosen unit back to internal nanometers.
 * Rounds to 3 decimal places of nm to eliminate IEEE-754 floating-point noise (e.g. 0.29 * 1000).
 */
export function toNm(displayValue: number, unit: ThicknessUnit): number {
  if (!Number.isFinite(displayValue)) return 0;
  if (unit === 'um') {
    return Math.round(displayValue * 1000 * 1000) / 1000;
  }
  return Math.round(displayValue * 1000) / 1000;
}

/**
 * Format a numeric value cleanly without ugly trailing zeros (e.g. 0.250 -> "0.25", 3.000 -> "3").
 */
export function formatCleanDecimal(val: number, maxDecimals: number = 3): string {
  if (!Number.isFinite(val)) return '0';
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(val * factor) / factor;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/**
 * Format an internal nanometer thickness/depth/distance into a human-readable string
 * using the active base thickness unit ('nm' or 'um').
 */
export function formatThickness(nm: number, unit: ThicknessUnit): string {
  if (!Number.isFinite(nm)) return unit === 'um' ? '0 µm' : '0 nm';
  if (unit === 'um') {
    return `${formatCleanDecimal(nm / 1000, 3)} µm`;
  }
  return `${formatCleanDecimal(nm, 1)} nm`;
}
