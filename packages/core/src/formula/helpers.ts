import { MAX_FORMULA_TEXT } from "../model.ts";

export class FormulaRuntimeError extends Error {}

export function capText(s: string): string {
  if (s.length > MAX_FORMULA_TEXT) throw new FormulaRuntimeError("Text result too long");
  return s;
}

export function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : Number(String(v));
  if (Number.isNaN(n)) throw new FormulaRuntimeError(`Not a number: ${JSON.stringify(v)}`);
  return n;
}

const text = (v: unknown): string => (v == null ? "" : String(v));
const mapText = (f: (s: string) => string) => (v: unknown) => (v == null ? null : f(String(v)));

function dateAdd(date: unknown, amount: unknown, unit: unknown): string | null {
  if (date == null) return null;
  const input = String(date);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new FormulaRuntimeError(`Not a date: ${input}`);
  const n = toNumber(amount);
  switch (unit) {
    case "years": d.setUTCFullYear(d.getUTCFullYear() + n); break;
    case "months": d.setUTCMonth(d.getUTCMonth() + n); break;
    case "days": d.setUTCDate(d.getUTCDate() + n); break;
    case "hours": d.setTime(d.getTime() + n * 3_600_000); break;
    case "minutes": d.setTime(d.getTime() + n * 60_000); break;
    default: throw new FormulaRuntimeError(`Unknown unit: ${String(unit)} (use years, months, days, hours, minutes)`);
  }
  if (Number.isNaN(d.getTime())) throw new FormulaRuntimeError("Date out of range");
  const iso = d.toISOString();
  return input.length === 10 ? iso.slice(0, 10) : iso;
}

export const HELPERS: Record<string, (...args: unknown[]) => unknown> = {
  concat: (...args) => capText(args.map(text).join("")),
  lower: mapText((s) => s.toLowerCase()),
  upper: mapText((s) => s.toUpperCase()),
  trim: mapText((s) => s.trim()),
  slug: mapText((s) =>
    s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  ),
  if: (cond, a, b) => (cond ? a : b),
  round: (n, digits = 0) => {
    if (n == null) return null;
    const f = 10 ** toNumber(digits);
    return Math.round(toNumber(n) * f) / f;
  },
  dateAdd,
  coalesce: (...args) => args.find((v) => v != null) ?? null,
};

export const HELPER_NAMES: ReadonlySet<string> = new Set(Object.keys(HELPERS));
