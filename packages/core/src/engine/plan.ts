import type { Field } from "../model.ts";
import { compileFormula, type CompiledFormula } from "../formula/compile.ts";
import { getFieldType } from "../types/index.ts";
import type { FieldType } from "../types/registry.ts";

export class FormulaCycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`Circular formula reference: ${cycle.join(" → ")}`);
    this.cycle = cycle;
  }
}

// Kahn-style ordering that keeps declaration order among independent formulas.
export function formulaOrder(items: { name: string; refs: string[] }[]): string[] {
  const names = new Set(items.map((i) => i.name));
  const deps = new Map(items.map((i) => [i.name, i.refs.filter((r) => names.has(r))]));
  const done = new Set<string>();
  const out: string[] = [];
  while (out.length < items.length) {
    const next = items.find((i) => !done.has(i.name) && deps.get(i.name)!.every((d) => done.has(d)));
    if (!next) throw new FormulaCycleError(findCycle(deps, done));
    done.add(next.name);
    out.push(next.name);
  }
  return out;
}

function findCycle(deps: Map<string, string[]>, done: Set<string>): string[] {
  const start = [...deps.keys()].find((n) => !done.has(n))!;
  const path: string[] = [];
  let cur = start;
  while (!path.includes(cur)) {
    path.push(cur);
    cur = deps.get(cur)!.find((d) => !done.has(d))!;
  }
  return [...path.slice(path.indexOf(cur)), cur];
}

export interface PlannedField {
  field: Field;
  type: FieldType;
  options: Record<string, unknown>;
  formula?: CompiledFormula;
  children?: FieldListPlan;
}

export interface FieldListPlan {
  fields: PlannedField[];
  formulas: PlannedField[];
}

export function planFields(fields: Field[]): FieldListPlan {
  const planned: PlannedField[] = fields.map((field) => {
    const type = getFieldType(field.type);
    if (!type) throw new Error(`Unknown field type: ${field.type}`);
    const options = type.options.parse(field.options) as Record<string, unknown>;
    const p: PlannedField = { field, type, options };
    if (type.kind === "formula") p.formula = compileFormula(options.expression as string);
    if (type.kind === "object" || type.kind === "array") p.children = planFields(field.children ?? []);
    return p;
  });
  const formulaFields = planned.filter((p) => p.formula);
  const order = formulaOrder(formulaFields.map((p) => ({ name: p.field.name, refs: p.formula!.refs })));
  return { fields: planned, formulas: order.map((n) => formulaFields.find((p) => p.field.name === n)!) };
}
