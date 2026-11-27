/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DesignVariable,
  DicingStreet,
  GdsSectionLine,
  GdsShape,
  MaskWindow,
  ProcessFlow,
  ProcessStep,
  ProcessStepVariant,
  SacrificialReleaseRegion,
  SubstrateLayer,
  VariableUnit,
} from '../types/microfab';
import { syncActiveVariantSnapshot } from './variantUtils';

export interface EvalResult {
  ok: true;
  value: number;
}

export interface EvalErrorResult {
  ok: false;
  error: string;
}

export type ParamEvalResult = EvalResult | EvalErrorResult;

export interface VariableDiagnostic {
  value: number; // In variable's display unit
  canonicalValue: number; // nm for length units ('nm'|'um'), raw otherwise
  error?: string;
}

export interface VariableUsageSummary {
  count: number;
  targets: string[];
}

export const BUILTIN_CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  E: Math.E,
};

const BUILTIN_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: (...args) => (args.length === 0 ? NaN : Math.min(...args)),
  max: (...args) => (args.length === 0 ? NaN : Math.max(...args)),
  abs: (x) => Math.abs(x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  sqrt: (x) => (x < 0 ? NaN : Math.sqrt(x)),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
};

export function isLengthUnit(unit: VariableUnit): boolean {
  return unit === 'nm' || unit === 'um';
}

export function toCanonicalValue(value: number, unit: VariableUnit): number {
  if (!Number.isFinite(value)) return 0;
  return unit === 'um' ? value * 1000 : value;
}

export function fromCanonicalValue(canonical: number, unit: VariableUnit): number {
  if (!Number.isFinite(canonical)) return 0;
  return unit === 'um' ? canonical / 1000 : canonical;
}

export function formatVariableValue(value: number, unit: VariableUnit): string {
  if (!Number.isFinite(value)) return '—';
  const clean = Math.round(value * 10000) / 10000;
  switch (unit) {
    case 'nm':
      return `${clean} nm`;
    case 'um':
      return `${clean} µm`;
    case 'deg':
      return `${clean}°`;
    case 'sec':
      return `${clean} s`;
    default:
      return `${clean}`;
  }
}

export function sanitizeVariableName(raw: string): string {
  let cleaned = raw.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return 'var_1';
  if (/^[0-9]/.test(cleaned)) {
    cleaned = `v_${cleaned}`;
  }
  return cleaned;
}

export function suggestVariableName(
  base: string,
  existing: DesignVariable[]
): string {
  const used = new Set(existing.map((v) => v.name));
  const cleanBase = sanitizeVariableName(base);
  if (!used.has(cleanBase) && !BUILTIN_CONSTANTS[cleanBase] && !BUILTIN_FUNCTIONS[cleanBase]) {
    return cleanBase;
  }
  let idx = 2;
  while (used.has(`${cleanBase}_${idx}`)) {
    idx++;
  }
  return `${cleanBase}_${idx}`;
}

export interface EvalExpressionOptions {
  /** Designated unit for bare numeric literals when evaluating a DesignVariable formula */
  targetUnit?: VariableUnit;
  /** Variable names in `scope` that hold canonical length values in nm (WAFER_W is always treated as length) */
  lengthVarNames?: Set<string>;
}

type Token =
  | { type: 'num'; value: number; hasExplicitLengthUnit: boolean }
  | { type: 'ident'; name: string }
  | { type: 'op'; op: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' };

function tokenize(expr: string): { ok: true; tokens: Token[] } | { ok: false; error: string } {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Numbers (with optional scientific notation and optional unit suffix nm/um/µm/mm/deg/sec/s/ms/min)
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < n && /[0-9]/.test(expr[i + 1]))) {
      const start = i;
      while (i < n && /[0-9.]/.test(expr[i])) i++;
      if (i < n && (expr[i] === 'e' || expr[i] === 'E')) {
        const expPos = i;
        i++;
        if (i < n && (expr[i] === '+' || expr[i] === '-')) i++;
        if (i < n && /[0-9]/.test(expr[i])) {
          while (i < n && /[0-9]/.test(expr[i])) i++;
        } else {
          i = expPos;
        }
      }
      const numVal = parseFloat(expr.slice(start, i));
      if (!Number.isFinite(numVal)) {
        return { ok: false, error: `Invalid number "${expr.slice(start, i)}"` };
      }

      // Optional unit suffix (attached or separated by horizontal spaces, e.g. 500nm, 500 nm, 2.5µm, 30s)
      let mult = 1;
      let hasExplicitLengthUnit = false;
      const rest = expr.slice(i);
      const unitMatch = rest.match(/^[ \t]*(nm|um|µm|mm|deg|sec|ms|min|s)(?![a-zA-Z0-9_(])/);
      if (unitMatch) {
        const u = unitMatch[1];
        if (u === 'nm') {
          mult = 1;
          hasExplicitLengthUnit = true;
        } else if (u === 'um' || u === 'µm') {
          mult = 1000;
          hasExplicitLengthUnit = true;
        } else if (u === 'mm') {
          mult = 1_000_000;
          hasExplicitLengthUnit = true;
        } else if (u === 'ms') {
          mult = 0.001;
        } else if (u === 'min') {
          mult = 60;
        }
        i += unitMatch[0].length;
      }

      tokens.push({ type: 'num', value: numVal * mult, hasExplicitLengthUnit });
      continue;
    }

    // Identifiers (variables, constants, function names)
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[a-zA-Z0-9_]/.test(expr[i])) i++;
      tokens.push({ type: 'ident', name: expr.slice(start, i) });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '^') {
      tokens.push({ type: 'op', op: ch });
      i++;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }

    return { ok: false, error: `Unexpected character "${ch}"` };
  }

  return { ok: true, tokens };
}

/**
 * Extracts referenced variable names from an expression string.
 */
export function extractReferencedVariables(expr: string): string[] {
  const tokRes = tokenize(expr);
  if (!tokRes.ok) return [];
  const refs = new Set<string>();
  const tokens = tokRes.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    const next = tokens[i + 1];
    // Function call if immediately followed by '('
    if (next && next.type === 'paren' && next.value === '(' && BUILTIN_FUNCTIONS[t.name]) {
      continue;
    }
    if (BUILTIN_CONSTANTS[t.name] !== undefined) continue;
    refs.add(t.name);
  }
  return Array.from(refs);
}

/**
 * Internal evaluated node with physical length-dimension exponent:
 * - `null`: bare numeric literal / pure numeric sub-expression (no unit explicitly stated)
 * - `0`: explicitly dimensionless scalar (e.g. aspect_ratio variable or length/length ratio)
 * - `1`: length in canonical nm
 * - `n`: length^n (e.g. area = 2 in sqrt(w^2 + d^2))
 */
interface DimVal {
  value: number;
  lenPow: number | null;
}

type DimParseResult = { ok: true; node: DimVal } | EvalErrorResult;

/**
 * Safely evaluates a mathematical expression against a variable lookup table.
 * Length variables in `scope` hold their canonical value in nm.
 * When `options.targetUnit` is supplied (e.g. from the variable editor), bare
 * numbers are evaluated in that designated unit unless an explicit unit suffix
 * or dimensional context dictates otherwise.
 */
export function evaluateParamExpression(
  expression: string,
  scope: Record<string, number>,
  options?: EvalExpressionOptions
): ParamEvalResult {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty expression' };
  }

  const tokRes = tokenize(trimmed);
  if (!tokRes.ok) return tokRes;
  const tokens = tokRes.tokens;
  if (tokens.length === 0) {
    return { ok: false, error: 'Empty expression' };
  }

  const targetUnit: VariableUnit = options?.targetUnit ?? 'nm';
  const lengthUnitForBare: VariableUnit = isLengthUnit(targetUnit) ? targetUnit : 'nm';
  const lengthVarNames = options?.lengthVarNames;

  const isBareOrScalar = (d: DimVal): boolean => d.lenPow === null || d.lenPow === 0;
  const coerceToLengthNm = (d: DimVal): number =>
    d.lenPow === 1 ? d.value : toCanonicalValue(d.value, lengthUnitForBare);

  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const parseExpr = (): DimParseResult => parseAddSub();

  const parseAddSub = (): DimParseResult => {
    let leftRes = parseMulDiv();
    if (!leftRes.ok) return leftRes;
    let left = leftRes.node;

    while (pos < tokens.length) {
      const t = peek();
      if (t?.type === 'op' && (t.op === '+' || t.op === '-')) {
        consume();
        const rightRes = parseMulDiv();
        if (!rightRes.ok) return rightRes;
        const right = rightRes.node;

        if (left.lenPow === right.lenPow) {
          left = {
            value: t.op === '+' ? left.value + right.value : left.value - right.value,
            lenPow: left.lenPow,
          };
        } else if (left.lenPow === 1 && isBareOrScalar(right)) {
          const rNm = coerceToLengthNm(right);
          left = {
            value: t.op === '+' ? left.value + rNm : left.value - rNm,
            lenPow: 1,
          };
        } else if (isBareOrScalar(left) && right.lenPow === 1) {
          const lNm = coerceToLengthNm(left);
          left = {
            value: t.op === '+' ? lNm + right.value : lNm - right.value,
            lenPow: 1,
          };
        } else {
          left = {
            value: t.op === '+' ? left.value + right.value : left.value - right.value,
            lenPow: left.lenPow ?? right.lenPow,
          };
        }
      } else {
        break;
      }
    }
    return { ok: true, node: left };
  };

  const parseMulDiv = (): DimParseResult => {
    let leftRes = parsePower();
    if (!leftRes.ok) return leftRes;
    let left = leftRes.node;

    while (pos < tokens.length) {
      const t = peek();
      if (t?.type === 'op' && (t.op === '*' || t.op === '/' || t.op === '%')) {
        consume();
        const rightRes = parsePower();
        if (!rightRes.ok) return rightRes;
        const right = rightRes.node;

        if (t.op === '*') {
          let nextPow: number | null;
          if (left.lenPow === null && right.lenPow === null) nextPow = null;
          else if (left.lenPow === null) nextPow = right.lenPow;
          else if (right.lenPow === null) nextPow = left.lenPow;
          else nextPow = left.lenPow + right.lenPow;
          left = { value: left.value * right.value, lenPow: nextPow };
        } else if (t.op === '/') {
          if (right.value === 0) return { ok: false, error: 'Division by zero' };
          let nextPow: number | null;
          if (left.lenPow === null && right.lenPow === null) nextPow = null;
          else if (right.lenPow === null) nextPow = left.lenPow;
          else if (left.lenPow === null) nextPow = -right.lenPow;
          else nextPow = left.lenPow - right.lenPow;
          left = { value: left.value / right.value, lenPow: nextPow };
        } else {
          if (right.value === 0) return { ok: false, error: 'Modulo by zero' };
          if (left.lenPow === 1 && isBareOrScalar(right)) {
            const rNm = coerceToLengthNm(right);
            if (rNm === 0) return { ok: false, error: 'Modulo by zero' };
            left = { value: left.value % rNm, lenPow: 1 };
          } else if (isBareOrScalar(left) && right.lenPow === 1) {
            const lNm = coerceToLengthNm(left);
            left = { value: lNm % right.value, lenPow: 1 };
          } else {
            left = { value: left.value % right.value, lenPow: left.lenPow ?? right.lenPow };
          }
        }
      } else {
        break;
      }
    }
    return { ok: true, node: left };
  };

  const parsePower = (): DimParseResult => {
    const baseRes = parseUnary();
    if (!baseRes.ok) return baseRes;
    const base = baseRes.node;
    const t = peek();
    if (t?.type === 'op' && t.op === '^') {
      consume();
      const expRes = parsePower(); // right-associative
      if (!expRes.ok) return expRes;
      const exp = expRes.node;
      const res = Math.pow(base.value, exp.value);
      if (!Number.isFinite(res)) return { ok: false, error: 'Numeric overflow' };
      const nextPow =
        base.lenPow !== null && base.lenPow !== 0 ? base.lenPow * exp.value : base.lenPow;
      return { ok: true, node: { value: res, lenPow: nextPow } };
    }
    return { ok: true, node: base };
  };

  const parseUnary = (): DimParseResult => {
    const t = peek();
    if (t?.type === 'op' && (t.op === '+' || t.op === '-')) {
      consume();
      const inner = parseUnary();
      if (!inner.ok) return inner;
      return {
        ok: true,
        node: {
          value: t.op === '-' ? -inner.node.value : inner.node.value,
          lenPow: inner.node.lenPow,
        },
      };
    }
    return parsePrimary();
  };

  const parsePrimary = (): DimParseResult => {
    const t = peek();
    if (!t) {
      return { ok: false, error: 'Unexpected end of expression' };
    }

    if (t.type === 'num') {
      consume();
      return {
        ok: true,
        node: {
          value: t.value,
          lenPow: t.hasExplicitLengthUnit ? 1 : null,
        },
      };
    }

    if (t.type === 'paren' && t.value === '(') {
      consume();
      const inner = parseExpr();
      if (!inner.ok) return inner;
      const close = peek();
      if (!close || close.type !== 'paren' || close.value !== ')') {
        return { ok: false, error: 'Missing closing parenthesis ")"' };
      }
      consume();
      return inner;
    }

    if (t.type === 'ident') {
      consume();
      const next = peek();
      if (next && next.type === 'paren' && next.value === '(') {
        const fn = BUILTIN_FUNCTIONS[t.name];
        if (!fn) {
          return { ok: false, error: `Unknown function "${t.name}()"` };
        }
        consume(); // '('
        const args: DimVal[] = [];
        const afterOpen = peek();
        if (!(afterOpen && afterOpen.type === 'paren' && afterOpen.value === ')')) {
          while (true) {
            const arg = parseExpr();
            if (!arg.ok) return arg;
            args.push(arg.node);
            const sep = peek();
            if (sep && sep.type === 'comma') {
              consume();
              continue;
            }
            break;
          }
        }
        const close = peek();
        if (!close || close.type !== 'paren' || close.value !== ')') {
          return { ok: false, error: `Expected ")" after ${t.name}(...)` };
        }
        consume();

        let evalArgs = args.map((a) => a.value);
        let resultLenPow: number | null = args[0]?.lenPow ?? null;

        if (t.name === 'min' || t.name === 'max' || t.name === 'clamp') {
          const hasLenArg = args.some((a) => a.lenPow === 1);
          if (hasLenArg) {
            evalArgs = args.map((a) => coerceToLengthNm(a));
            resultLenPow = 1;
          }
        } else if (t.name === 'round' || t.name === 'floor' || t.name === 'ceil') {
          if (args.length > 0 && args[0].lenPow === 1) {
            const inDisplayUnit = fromCanonicalValue(args[0].value, lengthUnitForBare);
            const rounded = fn(inDisplayUnit);
            if (!Number.isFinite(rounded)) {
              return { ok: false, error: `Invalid result in ${t.name}()` };
            }
            return {
              ok: true,
              node: {
                value: toCanonicalValue(rounded, lengthUnitForBare),
                lenPow: 1,
              },
            };
          }
        } else if (t.name === 'sqrt') {
          if (args.length > 0 && args[0].lenPow !== null && args[0].lenPow !== 0) {
            resultLenPow = args[0].lenPow / 2;
          }
        } else if (t.name === 'sin' || t.name === 'cos' || t.name === 'tan') {
          resultLenPow = null;
        }

        const res = fn(...evalArgs);
        if (!Number.isFinite(res)) {
          return { ok: false, error: `Invalid result in ${t.name}()` };
        }
        return { ok: true, node: { value: res, lenPow: resultLenPow } };
      }

      if (BUILTIN_CONSTANTS[t.name] !== undefined) {
        return { ok: true, node: { value: BUILTIN_CONSTANTS[t.name], lenPow: null } };
      }

      if (Object.prototype.hasOwnProperty.call(scope, t.name)) {
        const isLenVar = lengthVarNames
          ? lengthVarNames.has(t.name)
          : t.name === 'WAFER_W';
        return {
          ok: true,
          node: {
            value: scope[t.name],
            lenPow: isLenVar ? 1 : 0,
          },
        };
      }

      return { ok: false, error: `Unknown variable "${t.name}"` };
    }

    return { ok: false, error: 'Invalid syntax in expression' };
  };

  const result = parseExpr();
  if (!result.ok) return result;

  if (pos < tokens.length) {
    return { ok: false, error: 'Unexpected trailing tokens' };
  }

  const root = result.node;
  const finalValue =
    isLengthUnit(targetUnit) && isBareOrScalar(root)
      ? toCanonicalValue(root.value, targetUnit)
      : root.value;

  if (!Number.isFinite(finalValue)) {
    return { ok: false, error: 'Non-finite result' };
  }

  return { ok: true, value: finalValue };
}

/**
 * Builds canonical variable scope (nm for 'nm'|'um', raw value for other units)
 * resolving variable-to-variable formulas topologically while catching cycles.
 */
export function resolveVariables(
  variables: DesignVariable[],
  waferWidthNm: number = 10000
): {
  variables: DesignVariable[];
  scope: Record<string, number>;
  diagnostics: Record<string, VariableDiagnostic>;
} {
  const byName = new Map<string, DesignVariable>();
  const lengthVarNames = new Set<string>(['WAFER_W']);
  for (const v of variables) {
    if (v.name && !byName.has(v.name)) {
      byName.set(v.name, v);
      if (isLengthUnit(v.unit)) {
        lengthVarNames.add(v.name);
      } else if (v.name === 'WAFER_W') {
        lengthVarNames.delete('WAFER_W');
      }
    }
  }

  const scope: Record<string, number> = {
    WAFER_W: waferWidthNm,
  };
  const diagnostics: Record<string, VariableDiagnostic> = {};
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const evalVar = (v: DesignVariable): number => {
    if (visited.has(v.id)) {
      return diagnostics[v.id]?.canonicalValue ?? toCanonicalValue(v.value, v.unit);
    }

    const fallbackCanonical = toCanonicalValue(v.value, v.unit);

    if (!v.expression || !v.expression.trim()) {
      visited.add(v.id);
      scope[v.name] = fallbackCanonical;
      diagnostics[v.id] = {
        value: v.value,
        canonicalValue: fallbackCanonical,
      };
      return fallbackCanonical;
    }

    if (visiting.has(v.name)) {
      diagnostics[v.id] = {
        value: v.value,
        canonicalValue: fallbackCanonical,
        error: `Circular reference involving "${v.name}"`,
      };
      return fallbackCanonical;
    }

    visiting.add(v.name);
    const refs = extractReferencedVariables(v.expression);
    for (const ref of refs) {
      const target = byName.get(ref);
      if (target && target.id !== v.id) {
        if (visiting.has(target.name)) {
          visiting.delete(v.name);
          visited.add(v.id);
          diagnostics[v.id] = {
            value: v.value,
            canonicalValue: fallbackCanonical,
            error: `Circular reference: ${v.name} → ${target.name}`,
          };
          scope[v.name] = fallbackCanonical;
          return fallbackCanonical;
        }
        evalVar(target);
      }
    }
    visiting.delete(v.name);

    const evalRes = evaluateParamExpression(v.expression, scope, {
      targetUnit: v.unit,
      lengthVarNames,
    });
    visited.add(v.id);
    if (evalRes.ok) {
      const canonical = evalRes.value;
      const displayVal = fromCanonicalValue(canonical, v.unit);
      scope[v.name] = canonical;
      diagnostics[v.id] = {
        value: displayVal,
        canonicalValue: canonical,
      };
      return canonical;
    } else {
      scope[v.name] = fallbackCanonical;
      diagnostics[v.id] = {
        value: v.value,
        canonicalValue: fallbackCanonical,
        error: evalRes.error,
      };
      return fallbackCanonical;
    }
  };

  for (const v of variables) {
    evalVar(v);
  }

  const resolvedVars = variables.map((v) => {
    const diag = diagnostics[v.id];
    if (!diag || diag.error) return v;
    const roundedDisplay = Math.round(diag.value * 100000) / 100000;
    return roundedDisplay !== v.value ? { ...v, value: roundedDisplay } : v;
  });

  return { variables: resolvedVars, scope, diagnostics };
}

function evalBoundValue(
  bindings: Record<string, string> | undefined,
  key: string,
  scope: Record<string, number>
): number | null {
  const expr = bindings?.[key];
  if (!expr || !expr.trim()) return null;
  const res = evaluateParamExpression(expr, scope);
  return res.ok ? res.value : null;
}

function clampWindowPair(
  xStart: number,
  xEnd: number,
  waferWidth: number
): { xStart: number; xEnd: number } {
  const s = Math.max(0, Math.min(waferWidth, Math.round(xStart)));
  const e = Math.max(0, Math.min(waferWidth, Math.round(xEnd)));
  return s <= e ? { xStart: s, xEnd: e } : { xStart: e, xEnd: s };
}

function resolveMaskWindow(
  win: MaskWindow,
  scope: Record<string, number>,
  waferWidth: number
): MaskWindow {
  const b = win.paramBindings;
  if (!b) return win;
  const xStartVal = evalBoundValue(b, 'xStart', scope);
  const xEndVal = evalBoundValue(b, 'xEnd', scope);
  const widthVal = evalBoundValue(b, 'width', scope);

  if (widthVal !== null) {
    const clampedW = Math.max(10, Math.min(waferWidth, Math.round(widthVal)));
    if (xStartVal !== null && xEndVal === null) {
      const s = Math.max(0, Math.min(waferWidth - clampedW, Math.round(xStartVal)));
      return { ...win, xStart: s, xEnd: s + clampedW };
    }
    if (xEndVal !== null && xStartVal === null) {
      const e = Math.max(clampedW, Math.min(waferWidth, Math.round(xEndVal)));
      return { ...win, xStart: e - clampedW, xEnd: e };
    }
    if (xStartVal === null && xEndVal === null) {
      const center = (win.xStart + win.xEnd) / 2;
      let nextStart = center - clampedW / 2;
      let nextEnd = center + clampedW / 2;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = Math.min(waferWidth, clampedW);
      } else if (nextEnd > waferWidth) {
        nextEnd = waferWidth;
        nextStart = Math.max(0, waferWidth - clampedW);
      }
      return { ...win, xStart: Math.round(nextStart), xEnd: Math.round(nextEnd) };
    }
  }

  if (xStartVal !== null || xEndVal !== null) {
    const nextStart = xStartVal !== null ? xStartVal : win.xStart;
    const nextEnd = xEndVal !== null ? xEndVal : win.xEnd;
    const pair = clampWindowPair(nextStart, nextEnd, waferWidth);
    return { ...win, ...pair };
  }

  return win;
}

function resolveReleaseRegion(
  region: SacrificialReleaseRegion,
  scope: Record<string, number>,
  waferWidth: number
): SacrificialReleaseRegion {
  const b = region.paramBindings;
  if (!b) return region;
  const xStartVal = evalBoundValue(b, 'xStart', scope);
  const xEndVal = evalBoundValue(b, 'xEnd', scope);
  if (xStartVal === null && xEndVal === null) return region;
  const nextStart = xStartVal !== null ? xStartVal : region.xStart;
  const nextEnd = xEndVal !== null ? xEndVal : region.xEnd;
  const pair = clampWindowPair(nextStart, nextEnd, waferWidth);
  return { ...region, ...pair };
}

function resolveGdsShape(shape: GdsShape, scope: Record<string, number>): GdsShape {
  const b = shape.paramBindings;
  if (!b) return shape;

  if (shape.type === 'rect') {
    const x = evalBoundValue(b, 'x', scope);
    const y = evalBoundValue(b, 'y', scope);
    const width = evalBoundValue(b, 'width', scope);
    const height = evalBoundValue(b, 'height', scope);
    return {
      ...shape,
      ...(x !== null ? { x: Math.round(x) } : {}),
      ...(y !== null ? { y: Math.round(y) } : {}),
      ...(width !== null ? { width: Math.max(10, Math.round(width)) } : {}),
      ...(height !== null ? { height: Math.max(10, Math.round(height)) } : {}),
    };
  }

  if (shape.type === 'circle') {
    const cx = evalBoundValue(b, 'cx', scope);
    const cy = evalBoundValue(b, 'cy', scope);
    const diam = evalBoundValue(b, 'diameter', scope);
    const rad = evalBoundValue(b, 'radius', scope);
    const nextRadius =
      diam !== null
        ? Math.max(10, Math.round(diam / 2))
        : rad !== null
        ? Math.max(10, Math.round(rad))
        : undefined;
    return {
      ...shape,
      ...(cx !== null ? { cx: Math.round(cx) } : {}),
      ...(cy !== null ? { cy: Math.round(cy) } : {}),
      ...(nextRadius !== undefined ? { radius: nextRadius } : {}),
    };
  }

  if (shape.type === 'path') {
    const pathWidth = evalBoundValue(b, 'pathWidth', scope);
    return {
      ...shape,
      ...(pathWidth !== null ? { pathWidth: Math.max(10, Math.round(pathWidth)) } : {}),
    };
  }

  return shape;
}

function resolveGdsSectionLine(
  line: GdsSectionLine,
  scope: Record<string, number>
): GdsSectionLine {
  const b = line.paramBindings;
  if (!b) return line;
  const x1 = evalBoundValue(b, 'x1', scope);
  const y1 = evalBoundValue(b, 'y1', scope);
  const x2 = evalBoundValue(b, 'x2', scope);
  const y2 = evalBoundValue(b, 'y2', scope);
  if (x1 === null && y1 === null && x2 === null && y2 === null) return line;

  const nx1 = x1 !== null ? Math.round(x1) : line.x1;
  const ny1 = y1 !== null ? Math.round(y1) : line.y1;
  const nx2 = x2 !== null ? Math.round(x2) : line.x2;
  const ny2 = y2 !== null ? Math.round(y2) : line.y2;

  const nextPts =
    line.points && line.points.length >= 2
      ? line.points.map((pt, idx, arr) => {
          if (idx === 0) return { x: nx1, y: ny1 };
          if (idx === arr.length - 1) return { x: nx2, y: ny2 };
          return pt;
        })
      : undefined;

  return {
    ...line,
    x1: nx1,
    y1: ny1,
    x2: nx2,
    y2: ny2,
    ...(nextPts ? { points: nextPts } : {}),
  };
}

/**
 * Evaluates all DesignVariables and propagates any bound expressions into
 * substrate, process steps, mask windows, dicing streets, and GDS geometries.
 */
export function resolveFlowParameters(flow: ProcessFlow): ProcessFlow {
  const vars = flow.variables || [];
  const hasFlowBindings = Boolean(
    flow.paramBindings && Object.keys(flow.paramBindings).length > 0
  );

  // Fast exit when no variables and no bindings exist
  if (vars.length === 0 && !hasFlowBindings) {
    const anyBound =
      flow.substrateLayers.some((l) => l.paramBindings && Object.keys(l.paramBindings).length > 0) ||
      flow.steps.some(
        (s) =>
          (s.paramBindings && Object.keys(s.paramBindings).length > 0) ||
          s.lithography?.windows?.some((w) => w.paramBindings && Object.keys(w.paramBindings).length > 0) ||
          s.dicing?.streets?.some((st) => st.paramBindings && Object.keys(st.paramBindings).length > 0) ||
          s.strip?.releaseRegions?.some((r) => r.paramBindings && Object.keys(r.paramBindings).length > 0) ||
          Boolean(
            s.variants?.some(
              (v) =>
                (v.paramBindings && Object.keys(v.paramBindings).length > 0) ||
                v.lithography?.windows?.some((w) => w.paramBindings && Object.keys(w.paramBindings).length > 0) ||
                v.dicing?.streets?.some((st) => st.paramBindings && Object.keys(st.paramBindings).length > 0) ||
                v.strip?.releaseRegions?.some((r) => r.paramBindings && Object.keys(r.paramBindings).length > 0)
            )
          )
      ) ||
      Boolean(flow.masks?.some((m) => m.windows.some((w) => w.paramBindings && Object.keys(w.paramBindings).length > 0))) ||
      Boolean(flow.alignmentMarks?.some((am) => am.paramBindings && Object.keys(am.paramBindings).length > 0)) ||
      Boolean(flow.gdsLayout?.shapes.some((sh) => sh.paramBindings && Object.keys(sh.paramBindings).length > 0));
    if (!anyBound) return flow;
  }

  let { variables: resolvedVars, scope } = resolveVariables(vars, flow.substrateWidth || 10000);

  // Update wafer width if bound
  let nextSubstrateWidth = flow.substrateWidth || 10000;
  const boundWaferW = evalBoundValue(flow.paramBindings, 'substrateWidth', scope);
  if (boundWaferW !== null) {
    nextSubstrateWidth = Math.max(1000, Math.min(1000000, Math.round(boundWaferW)));
    // Re-resolve if WAFER_W changed and wasn't shadowed by a user variable
    if (nextSubstrateWidth !== flow.substrateWidth && !vars.some((v) => v.name === 'WAFER_W')) {
      const re = resolveVariables(resolvedVars, nextSubstrateWidth);
      resolvedVars = re.variables;
      scope = re.scope;
    }
  }

  // Update substrate layers
  const nextLayers: SubstrateLayer[] = flow.substrateLayers.map((layer) => {
    const t = evalBoundValue(layer.paramBindings, 'thickness', scope);
    if (t === null) return layer;
    return { ...layer, thickness: Math.max(5, Math.round(t)) };
  });
  const nextSubstrateThickness = nextLayers.reduce((acc, l) => acc + (l.thickness || 0), 0);

  // Update process steps
  const nextSteps: ProcessStep[] = flow.steps.map((step) => {
    const b = step.paramBindings;
    let updated = step;

    if (step.type === 'deposition' && step.deposition) {
      const t = evalBoundValue(b, 'deposition.thickness', scope);
      if (t !== null) {
        const clamped = Math.max(5, Math.round(t));
        updated = {
          ...updated,
          thickness: clamped,
          deposition: { ...step.deposition, thickness: clamped },
        };
      }
    } else if (step.type === 'lithography' && step.lithography) {
      const rt = evalBoundValue(b, 'lithography.resistThickness', scope);
      const sw = evalBoundValue(b, 'lithography.sidewallAngle', scope);
      const lt = evalBoundValue(b, 'lithography.lorThickness', scope);
      const lu = evalBoundValue(b, 'lithography.lorUndercut', scope);
      const nextWindows = (step.lithography.windows || []).map((w) =>
        resolveMaskWindow(w, scope, nextSubstrateWidth)
      );
      updated = {
        ...updated,
        lithography: {
          ...step.lithography,
          ...(rt !== null ? { resistThickness: Math.max(100, Math.round(rt)) } : {}),
          ...(sw !== null ? { sidewallAngle: Math.max(75, Math.min(105, Math.round(sw))) } : {}),
          ...(lt !== null ? { lorThickness: Math.max(50, Math.round(lt)) } : {}),
          ...(lu !== null ? { lorUndercut: Math.max(0, Math.round(lu)) } : {}),
          windows: nextWindows,
        },
      };
    } else if (step.type === 'etch' && step.etch) {
      const d = evalBoundValue(b, 'etch.depth', scope);
      const sw = evalBoundValue(b, 'etch.sidewallAngle', scope);
      const et = evalBoundValue(b, 'etch.etchTimeSec', scope);
      const sd = evalBoundValue(b, 'etch.scallopDepth', scope);
      const sp = evalBoundValue(b, 'etch.scallopPitch', scope);
      const clampedD = d !== null ? Math.max(10, Math.round(d)) : undefined;
      updated = {
        ...updated,
        ...(clampedD !== undefined ? { thickness: clampedD } : {}),
        etch: {
          ...step.etch,
          ...(clampedD !== undefined ? { depth: clampedD } : {}),
          ...(sw !== null ? { sidewallAngle: Math.max(45, Math.min(110, Math.round(sw * 100) / 100)) } : {}),
          ...(et !== null ? { etchTimeSec: Math.max(1, Math.round(et)) } : {}),
          ...(sd !== null ? { scallopDepth: Math.max(5, Math.round(sd)) } : {}),
          ...(sp !== null ? { scallopPitch: Math.max(20, Math.round(sp)) } : {}),
        },
      };
    } else if (step.type === 'cmp' && step.cmp) {
      const d = evalBoundValue(b, 'cmp.depth', scope);
      const th = evalBoundValue(b, 'cmp.targetHeight', scope);
      updated = {
        ...updated,
        cmp: {
          ...step.cmp,
          ...(d !== null ? { depth: Math.max(10, Math.round(d)) } : {}),
          ...(th !== null ? { targetHeight: Math.max(-10000, Math.round(th)) } : {}),
        },
      };
    } else if (step.type === 'dicing' && step.dicing) {
      const kw = evalBoundValue(b, 'dicing.kerfWidth', scope);
      const cd = evalBoundValue(b, 'dicing.cutDepth', scope);
      const to = evalBoundValue(b, 'dicing.tapeOvercut', scope);
      const sw = evalBoundValue(b, 'dicing.sidewallAngle', scope);
      const nextStreets: DicingStreet[] = (step.dicing.streets || []).map((st) => {
        const xc = evalBoundValue(st.paramBindings, 'xCenter', scope);
        if (xc === null) return st;
        return {
          ...st,
          xCenter: Math.max(0, Math.min(nextSubstrateWidth, Math.round(xc))),
        };
      });
      updated = {
        ...updated,
        dicing: {
          ...step.dicing,
          ...(kw !== null ? { kerfWidth: Math.max(20, Math.round(kw)) } : {}),
          ...(cd !== null ? { cutDepth: Math.max(20, Math.round(cd)) } : {}),
          ...(to !== null ? { tapeOvercut: Math.max(0, Math.round(to)) } : {}),
          ...(sw !== null ? { sidewallAngle: Math.max(65, Math.min(90, Math.round(sw))) } : {}),
          streets: nextStreets,
        },
      };
    } else if (step.type === 'tape-frame' && step.tapeFrame) {
      const t = evalBoundValue(b, 'tapeFrame.thickness', scope);
      if (t !== null) {
        updated = {
          ...updated,
          tapeFrame: { ...step.tapeFrame, thickness: Math.max(25, Math.round(t)) },
        };
      }
    } else if (step.type === 'bonding' && step.bonding?.interfaceLayer) {
      const t = evalBoundValue(b, 'bonding.interfaceLayer.thickness', scope);
      if (t !== null) {
        updated = {
          ...updated,
          bonding: {
            ...step.bonding,
            interfaceLayer: {
              ...step.bonding.interfaceLayer,
              thickness: Math.max(5, Math.round(t)),
            },
          },
        };
      }
    } else if (step.type === 'strip' && step.strip?.releaseRegions?.length) {
      const nextRegions = step.strip.releaseRegions.map((r) =>
        resolveReleaseRegion(r, scope, nextSubstrateWidth)
      );
      updated = {
        ...updated,
        strip: {
          ...step.strip,
          releaseRegions: nextRegions,
        },
      };
    }

    if (updated.variants && updated.variants.length > 0) {
      const resolveVariant = (v: ProcessStepVariant): ProcessStepVariant => {
        const vb = v.paramBindings;
        let nextV = v;
        if (v.type === 'deposition' && v.deposition) {
          const t = evalBoundValue(vb, 'deposition.thickness', scope);
          if (t !== null) {
            const clamped = Math.max(5, Math.round(t));
            nextV = {
              ...nextV,
              thickness: clamped,
              deposition: { ...v.deposition, thickness: clamped },
            };
          }
        } else if (v.type === 'lithography' && v.lithography) {
          const rt = evalBoundValue(vb, 'lithography.resistThickness', scope);
          const sw = evalBoundValue(vb, 'lithography.sidewallAngle', scope);
          const lt = evalBoundValue(vb, 'lithography.lorThickness', scope);
          const lu = evalBoundValue(vb, 'lithography.lorUndercut', scope);
          const nextWindows = (v.lithography.windows || []).map((w) =>
            resolveMaskWindow(w, scope, nextSubstrateWidth)
          );
          nextV = {
            ...nextV,
            lithography: {
              ...v.lithography,
              ...(rt !== null ? { resistThickness: Math.max(100, Math.round(rt)) } : {}),
              ...(sw !== null ? { sidewallAngle: Math.max(75, Math.min(105, Math.round(sw))) } : {}),
              ...(lt !== null ? { lorThickness: Math.max(50, Math.round(lt)) } : {}),
              ...(lu !== null ? { lorUndercut: Math.max(0, Math.round(lu)) } : {}),
              windows: nextWindows,
            },
          };
        } else if (v.type === 'etch' && v.etch) {
          const d = evalBoundValue(vb, 'etch.depth', scope);
          const sw = evalBoundValue(vb, 'etch.sidewallAngle', scope);
          const et = evalBoundValue(vb, 'etch.etchTimeSec', scope);
          const sd = evalBoundValue(vb, 'etch.scallopDepth', scope);
          const sp = evalBoundValue(vb, 'etch.scallopPitch', scope);
          const clampedD = d !== null ? Math.max(10, Math.round(d)) : undefined;
          nextV = {
            ...nextV,
            ...(clampedD !== undefined ? { thickness: clampedD } : {}),
            etch: {
              ...v.etch,
              ...(clampedD !== undefined ? { depth: clampedD } : {}),
              ...(sw !== null ? { sidewallAngle: Math.max(45, Math.min(110, Math.round(sw * 100) / 100)) } : {}),
              ...(et !== null ? { etchTimeSec: Math.max(1, Math.round(et)) } : {}),
              ...(sd !== null ? { scallopDepth: Math.max(5, Math.round(sd)) } : {}),
              ...(sp !== null ? { scallopPitch: Math.max(20, Math.round(sp)) } : {}),
            },
          };
        } else if (v.type === 'cmp' && v.cmp) {
          const d = evalBoundValue(vb, 'cmp.depth', scope);
          const th = evalBoundValue(vb, 'cmp.targetHeight', scope);
          nextV = {
            ...nextV,
            cmp: {
              ...v.cmp,
              ...(d !== null ? { depth: Math.max(10, Math.round(d)) } : {}),
              ...(th !== null ? { targetHeight: Math.max(-10000, Math.round(th)) } : {}),
            },
          };
        } else if (v.type === 'dicing' && v.dicing) {
          const kw = evalBoundValue(vb, 'dicing.kerfWidth', scope);
          const cd = evalBoundValue(vb, 'dicing.cutDepth', scope);
          const to = evalBoundValue(vb, 'dicing.tapeOvercut', scope);
          const sw = evalBoundValue(vb, 'dicing.sidewallAngle', scope);
          const nextStreets: DicingStreet[] = (v.dicing.streets || []).map((st) => {
            const xc = evalBoundValue(st.paramBindings, 'xCenter', scope);
            if (xc === null) return st;
            return {
              ...st,
              xCenter: Math.max(0, Math.min(nextSubstrateWidth, Math.round(xc))),
            };
          });
          nextV = {
            ...nextV,
            dicing: {
              ...v.dicing,
              ...(kw !== null ? { kerfWidth: Math.max(20, Math.round(kw)) } : {}),
              ...(cd !== null ? { cutDepth: Math.max(20, Math.round(cd)) } : {}),
              ...(to !== null ? { tapeOvercut: Math.max(0, Math.round(to)) } : {}),
              ...(sw !== null ? { sidewallAngle: Math.max(65, Math.min(90, Math.round(sw))) } : {}),
              streets: nextStreets,
            },
          };
        } else if (v.type === 'tape-frame' && v.tapeFrame) {
          const t = evalBoundValue(vb, 'tapeFrame.thickness', scope);
          if (t !== null) {
            nextV = {
              ...nextV,
              tapeFrame: { ...v.tapeFrame, thickness: Math.max(25, Math.round(t)) },
            };
          }
        } else if (v.type === 'bonding' && v.bonding?.interfaceLayer) {
          const t = evalBoundValue(vb, 'bonding.interfaceLayer.thickness', scope);
          if (t !== null) {
            nextV = {
              ...nextV,
              bonding: {
                ...v.bonding,
                interfaceLayer: {
                  ...v.bonding.interfaceLayer,
                  thickness: Math.max(5, Math.round(t)),
                },
              },
            };
          }
        } else if (v.type === 'strip' && v.strip?.releaseRegions?.length) {
          const nextRegions = v.strip.releaseRegions.map((r) =>
            resolveReleaseRegion(r, scope, nextSubstrateWidth)
          );
          nextV = {
            ...nextV,
            strip: {
              ...v.strip,
              releaseRegions: nextRegions,
            },
          };
        }
        return nextV;
      };

      updated = syncActiveVariantSnapshot({
        ...updated,
        variants: updated.variants.map(resolveVariant),
      });
    }

    return updated;
  });

  // Update masks windows
  const nextMasks = flow.masks?.map((mask) => ({
    ...mask,
    windows: mask.windows.map((w) => resolveMaskWindow(w, scope, nextSubstrateWidth)),
  }));

  // Update global alignment marks
  const nextAlignmentMarks = flow.alignmentMarks?.map((am) => {
    const x = evalBoundValue(am.paramBindings, 'xNm', scope);
    if (x === null) return am;
    return {
      ...am,
      xNm: Math.max(0, Math.min(nextSubstrateWidth, Math.round(x))),
    };
  });

  // Update GDS shapes & section lines
  const nextGdsLayout = flow.gdsLayout
    ? {
        ...flow.gdsLayout,
        shapes: flow.gdsLayout.shapes.map((sh) => resolveGdsShape(sh, scope)),
        sectionLines: flow.gdsLayout.sectionLines?.map((sl) => resolveGdsSectionLine(sl, scope)),
        sectionLine: flow.gdsLayout.sectionLine
          ? resolveGdsSectionLine(flow.gdsLayout.sectionLine, scope)
          : undefined,
      }
    : undefined;

  return {
    ...flow,
    variables: resolvedVars,
    substrateWidth: nextSubstrateWidth,
    substrateLayers: nextLayers,
    substrateThickness: nextSubstrateThickness,
    steps: nextSteps,
    ...(nextMasks ? { masks: nextMasks } : {}),
    ...(nextAlignmentMarks ? { alignmentMarks: nextAlignmentMarks } : {}),
    ...(nextGdsLayout ? { gdsLayout: nextGdsLayout } : {}),
  };
}

/**
 * Counts where each variable name is referenced across the entire flow.
 */
export function countVariableUsages(flow: ProcessFlow): Record<string, VariableUsageSummary> {
  const result: Record<string, VariableUsageSummary> = {};
  const addRef = (varName: string, target: string) => {
    if (!result[varName]) {
      result[varName] = { count: 0, targets: [] };
    }
    result[varName].count += 1;
    if (!result[varName].targets.includes(target)) {
      result[varName].targets.push(target);
    }
  };

  const scanBindings = (bindings: Record<string, string> | undefined, prefix: string) => {
    if (!bindings) return;
    for (const [key, expr] of Object.entries(bindings)) {
      if (!expr || !expr.trim()) continue;
      for (const ref of extractReferencedVariables(expr)) {
        addRef(ref, `${prefix} (${key})`);
      }
    }
  };

  for (const v of flow.variables || []) {
    if (v.expression && v.expression.trim()) {
      for (const ref of extractReferencedVariables(v.expression)) {
        if (ref !== v.name) {
          addRef(ref, `Variable "${v.name}"`);
        }
      }
    }
  }

  scanBindings(flow.paramBindings, 'Wafer');

  flow.substrateLayers.forEach((layer, idx) => {
    scanBindings(layer.paramBindings, `Substrate: ${layer.name || `Layer #${idx + 1}`}`);
  });

  flow.steps.forEach((step, idx) => {
    const label = `Step ${idx + 1}: ${step.title}`;
    scanBindings(step.paramBindings, label);
    step.lithography?.windows?.forEach((w, wIdx) => {
      scanBindings(w.paramBindings, `${label} · Window #${wIdx + 1}`);
    });
    step.dicing?.streets?.forEach((st, stIdx) => {
      scanBindings(st.paramBindings, `${label} · Street #${stIdx + 1}`);
    });
    step.strip?.releaseRegions?.forEach((r, rIdx) => {
      scanBindings(r.paramBindings, `${label} · Release Region #${rIdx + 1}`);
    });
    step.variants?.forEach((variant) => {
      if (variant.id === step.activeVariantId) return;
      const vLabel = `${label} [${variant.name}]`;
      scanBindings(variant.paramBindings, vLabel);
      variant.lithography?.windows?.forEach((w, wIdx) => {
        scanBindings(w.paramBindings, `${vLabel} · Window #${wIdx + 1}`);
      });
      variant.dicing?.streets?.forEach((st, stIdx) => {
        scanBindings(st.paramBindings, `${vLabel} · Street #${stIdx + 1}`);
      });
      variant.strip?.releaseRegions?.forEach((r, rIdx) => {
        scanBindings(r.paramBindings, `${vLabel} · Release Region #${rIdx + 1}`);
      });
    });
  });

  flow.masks?.forEach((mask) => {
    const hasStep = Boolean(mask.assignedStepId);
    if (!hasStep) {
      mask.windows.forEach((w, wIdx) => {
        scanBindings(w.paramBindings, `Mask ${mask.name} · Window #${wIdx + 1}`);
      });
    }
  });

  flow.alignmentMarks?.forEach((am) => {
    scanBindings(am.paramBindings, `Alignment Mark ${am.label}`);
  });

  flow.gdsLayout?.shapes.forEach((shape, idx) => {
    scanBindings(shape.paramBindings, `GDS ${shape.type} #${idx + 1}`);
  });

  flow.gdsLayout?.sectionLines?.forEach((sl) => {
    scanBindings(sl.paramBindings, `GDS Cut ${sl.label}`);
  });

  return result;
}

/**
 * Renames a variable across all variable expressions and geometry paramBindings.
 */
export function renameVariableInFlow(
  flow: ProcessFlow,
  oldName: string,
  newName: string
): ProcessFlow {
  if (!oldName || !newName || oldName === newName) return flow;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`\\b${escaped}\\b`, 'g');
  const rewriteExpr = (expr: string): string => expr.replace(wordRe, newName);
  const rewriteMap = (bindings?: Record<string, string>): Record<string, string> | undefined => {
    if (!bindings) return bindings;
    const next: Record<string, string> = {};
    for (const [k, expr] of Object.entries(bindings)) {
      next[k] = expr ? rewriteExpr(expr) : expr;
    }
    return next;
  };

  return {
    ...flow,
    variables: (flow.variables || []).map((v) => ({
      ...v,
      name: v.name === oldName ? newName : v.name,
      expression: v.expression ? rewriteExpr(v.expression) : v.expression,
    })),
    paramBindings: rewriteMap(flow.paramBindings),
    substrateLayers: flow.substrateLayers.map((l) => ({
      ...l,
      paramBindings: rewriteMap(l.paramBindings),
    })),
    steps: flow.steps.map((s) => ({
      ...s,
      paramBindings: rewriteMap(s.paramBindings),
      lithography: s.lithography
        ? {
            ...s.lithography,
            windows: s.lithography.windows.map((w) => ({
              ...w,
              paramBindings: rewriteMap(w.paramBindings),
            })),
          }
        : undefined,
      dicing: s.dicing
        ? {
            ...s.dicing,
            streets: s.dicing.streets.map((st) => ({
              ...st,
              paramBindings: rewriteMap(st.paramBindings),
            })),
          }
        : undefined,
      strip: s.strip
        ? {
            ...s.strip,
            releaseRegions: s.strip.releaseRegions?.map((r) => ({
              ...r,
              paramBindings: rewriteMap(r.paramBindings),
            })),
          }
        : undefined,
      variants: s.variants?.map((v) => ({
        ...v,
        paramBindings: rewriteMap(v.paramBindings),
        lithography: v.lithography
          ? {
              ...v.lithography,
              windows: v.lithography.windows.map((w) => ({
                ...w,
                paramBindings: rewriteMap(w.paramBindings),
              })),
            }
          : undefined,
        dicing: v.dicing
          ? {
              ...v.dicing,
              streets: v.dicing.streets.map((st) => ({
                ...st,
                paramBindings: rewriteMap(st.paramBindings),
              })),
            }
          : undefined,
        strip: v.strip
          ? {
              ...v.strip,
              releaseRegions: v.strip.releaseRegions?.map((r) => ({
                ...r,
                paramBindings: rewriteMap(r.paramBindings),
              })),
            }
          : undefined,
      })),
    })),
    masks: flow.masks?.map((m) => ({
      ...m,
      windows: m.windows.map((w) => ({
        ...w,
        paramBindings: rewriteMap(w.paramBindings),
      })),
    })),
    alignmentMarks: flow.alignmentMarks?.map((am) => ({
      ...am,
      paramBindings: rewriteMap(am.paramBindings),
    })),
    gdsLayout: flow.gdsLayout
      ? {
          ...flow.gdsLayout,
          shapes: flow.gdsLayout.shapes.map((sh) => ({
            ...sh,
            paramBindings: rewriteMap(sh.paramBindings),
          })),
          sectionLines: flow.gdsLayout.sectionLines?.map((sl) => ({
            ...sl,
            paramBindings: rewriteMap(sl.paramBindings),
          })),
          sectionLine: flow.gdsLayout.sectionLine
            ? {
                ...flow.gdsLayout.sectionLine,
                paramBindings: rewriteMap(flow.gdsLayout.sectionLine.paramBindings),
              }
            : undefined,
        }
      : undefined,
  };
}

/**
 * Removes references to deleted variable names cleanly by unbinding or keeping literal value.
 */
export function removeVariableFromFlow(flow: ProcessFlow, varName: string): ProcessFlow {
  const cleanMap = (bindings?: Record<string, string>): Record<string, string> | undefined => {
    if (!bindings) return bindings;
    const next: Record<string, string> = {};
    for (const [k, expr] of Object.entries(bindings)) {
      if (!expr) continue;
      if (!extractReferencedVariables(expr).includes(varName)) {
        next[k] = expr;
      }
    }
    return Object.keys(next).length > 0 ? next : undefined;
  };

  return {
    ...flow,
    variables: (flow.variables || []).filter((v) => v.name !== varName),
    paramBindings: cleanMap(flow.paramBindings),
    substrateLayers: flow.substrateLayers.map((l) => ({
      ...l,
      paramBindings: cleanMap(l.paramBindings),
    })),
    steps: flow.steps.map((s) => ({
      ...s,
      paramBindings: cleanMap(s.paramBindings),
      lithography: s.lithography
        ? {
            ...s.lithography,
            windows: s.lithography.windows.map((w) => ({
              ...w,
              paramBindings: cleanMap(w.paramBindings),
            })),
          }
        : undefined,
      dicing: s.dicing
        ? {
            ...s.dicing,
            streets: s.dicing.streets.map((st) => ({
              ...st,
              paramBindings: cleanMap(st.paramBindings),
            })),
          }
        : undefined,
      strip: s.strip
        ? {
            ...s.strip,
            releaseRegions: s.strip.releaseRegions?.map((r) => ({
              ...r,
              paramBindings: cleanMap(r.paramBindings),
            })),
          }
        : undefined,
      variants: s.variants?.map((v) => ({
        ...v,
        paramBindings: cleanMap(v.paramBindings),
        lithography: v.lithography
          ? {
              ...v.lithography,
              windows: v.lithography.windows.map((w) => ({
                ...w,
                paramBindings: cleanMap(w.paramBindings),
              })),
            }
          : undefined,
        dicing: v.dicing
          ? {
              ...v.dicing,
              streets: v.dicing.streets.map((st) => ({
                ...st,
                paramBindings: cleanMap(st.paramBindings),
              })),
            }
          : undefined,
        strip: v.strip
          ? {
              ...v.strip,
              releaseRegions: v.strip.releaseRegions?.map((r) => ({
                ...r,
                paramBindings: cleanMap(r.paramBindings),
              })),
            }
          : undefined,
      })),
    })),
    masks: flow.masks?.map((m) => ({
      ...m,
      windows: m.windows.map((w) => ({
        ...w,
        paramBindings: cleanMap(w.paramBindings),
      })),
    })),
    alignmentMarks: flow.alignmentMarks?.map((am) => ({
      ...am,
      paramBindings: cleanMap(am.paramBindings),
    })),
    gdsLayout: flow.gdsLayout
      ? {
          ...flow.gdsLayout,
          shapes: flow.gdsLayout.shapes.map((sh) => ({
            ...sh,
            paramBindings: cleanMap(sh.paramBindings),
          })),
          sectionLines: flow.gdsLayout.sectionLines?.map((sl) => ({
            ...sl,
            paramBindings: cleanMap(sl.paramBindings),
          })),
        }
      : undefined,
  };
}

export const VARIABLE_PRESETS: {
  id: string;
  name: string;
  description: string;
  variables: Omit<DesignVariable, 'id'>[];
}[] = [
  {
    id: 'preset_gate_cd',
    name: 'Gate & Spacer Stack',
    description: 'Parametric gate CD, oxide thickness, and centered channel coordinates',
    variables: [
      { name: 'gate_cd', value: 1.2, unit: 'um', description: 'Gate critical dimension' },
      { name: 't_ox', value: 45, unit: 'nm', description: 'Gate dielectric thickness' },
      { name: 't_poly', value: 250, unit: 'nm', description: 'Polysilicon gate height' },
      {
        name: 'gate_x1',
        value: 4400,
        unit: 'nm',
        expression: 'WAFER_W / 2 - gate_cd / 2',
        description: 'Centered gate left edge',
      },
      {
        name: 'gate_x2',
        value: 5600,
        unit: 'nm',
        expression: 'WAFER_W / 2 + gate_cd / 2',
        description: 'Centered gate right edge',
      },
    ],
  },
  {
    id: 'preset_trench',
    name: 'DRIE Trench Array',
    description: 'Trench width, pitch, aspect ratio, and derived etch depth',
    variables: [
      { name: 'trench_w', value: 1.0, unit: 'um', description: 'Trench opening width' },
      { name: 'aspect_ratio', value: 4, unit: 'none', description: 'Target depth / width ratio' },
      {
        name: 'trench_depth',
        value: 4.0,
        unit: 'um',
        expression: 'trench_w * aspect_ratio',
        description: 'Target DRIE etch depth',
      },
      {
        name: 'pitch',
        value: 2.5,
        unit: 'um',
        expression: 'trench_w * 2.5',
        description: 'Center-to-center trench pitch',
      },
    ],
  },
  {
    id: 'preset_soi_mems',
    name: 'SOI MEMS Beam',
    description: 'Device Si thickness, BOX release gap, and beam width',
    variables: [
      { name: 'dev_si', value: 1.5, unit: 'um', description: 'SOI device layer thickness' },
      { name: 'box_thick', value: 500, unit: 'nm', description: 'Buried oxide sacrificial gap' },
      { name: 'beam_w', value: 2.0, unit: 'um', description: 'Suspended cantilever/beam width' },
    ],
  },
];
