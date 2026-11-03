import { MAX_NESTING, SchemaSchema, type Field, type Schema } from "./model.ts";
import { getFieldType } from "./types/index.ts";
import { isKnownLocale } from "./engine/fakers.ts";
import { compileFormula, FormulaError } from "./formula/compile.ts";
import { formulaOrder, FormulaCycleError } from "./engine/plan.ts";
import { findReferenceCycle, referencedFieldNames } from "./order.ts";

export interface ValidationIssue {
  path: string;
  message: string;
}

export function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, p) => {
    if (typeof p === "number") return `${acc}[${p}]`;
    return acc ? `${acc}.${String(p)}` : String(p);
  }, "");
}

// Iterative so that absurdly deep input cannot overflow the stack before zod runs.
// Level counting matches checkFields: the top-level list is level 0.
function exceedsNesting(fields: unknown): boolean {
  const stack: { list: unknown; level: number }[] = [{ list: fields, level: 0 }];
  while (stack.length) {
    const { list, level } = stack.pop()!;
    if (!Array.isArray(list)) continue;
    for (const field of list) {
      const children = (field as { children?: unknown } | null)?.children;
      if (!Array.isArray(children)) continue;
      if (level + 1 > MAX_NESTING) return true;
      stack.push({ list: children, level: level + 1 });
    }
  }
  return false;
}

export function validateSchema(input: unknown, others: Schema[]): { schema?: Schema; issues: ValidationIssue[] } {
  if (exceedsNesting((input as { fields?: unknown } | null)?.fields)) {
    return { issues: [{ path: "fields", message: `Nesting deeper than ${MAX_NESTING} levels is not allowed` }] };
  }
  const parsed = SchemaSchema.safeParse(input);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })) };
  }
  const schema = parsed.data;
  const set = [...others.filter((o) => o.id !== schema.id), schema];
  const issues: ValidationIssue[] = [];

  if (others.some((o) => o.slug === schema.slug && o.id !== schema.id)) {
    issues.push({ path: "slug", message: `Slug "${schema.slug}" is already used by another schema` });
  }
  if (!isKnownLocale(schema.locale)) {
    issues.push({ path: "locale", message: `Unknown locale "${schema.locale}"` });
  }

  checkFields(schema.fields, "fields", 0, { schema, set, issues });

  // Dependents keep their references to this schema valid after an edit.
  for (const dependent of others) {
    if (dependent.id === schema.id) continue;
    for (const fieldName of referencedFieldNames(dependent, schema.id)) {
      const field = schema.fields.find((f) => f.name === fieldName);
      if (!field || field.type === "object" || field.type === "array") {
        issues.push({
          path: "fields",
          message: `Schema "${dependent.slug}" references field "${fieldName}", which this change removes or turns into an object/array`,
        });
      }
    }
  }

  if (issues.length === 0) {
    const cycle = findReferenceCycle(set, schema.id);
    if (cycle) {
      const slug = (id: string) => set.find((s) => s.id === id)?.slug ?? id;
      issues.push({ path: "fields", message: `Circular reference between schemas: ${cycle.map(slug).join(" → ")}` });
    }
  }

  return issues.length ? { issues } : { schema, issues };
}

interface Ctx {
  schema: Schema;
  set: Schema[];
  issues: ValidationIssue[];
}

function checkFields(fields: Field[], path: string, level: number, ctx: Ctx): void {
  const seen = new Set<string>();
  const formulas: { name: string; refs: string[]; index: number }[] = [];

  fields.forEach((field, i) => {
    const at = `${path}[${i}]`;
    const duplicate = seen.has(field.name);
    if (duplicate) ctx.issues.push({ path: `${at}.name`, message: "Duplicate field name" });
    seen.add(field.name);

    const type = getFieldType(field.type);
    if (!type) {
      ctx.issues.push({ path: `${at}.type`, message: `Unknown type "${field.type}"` });
      return;
    }

    const opts = type.options.safeParse(field.options);
    if (!opts.success) {
      for (const issue of opts.error.issues) {
        ctx.issues.push({ path: formatPath([...splitPath(`${at}.options`), ...issue.path]), message: issue.message });
      }
      return;
    }
    const options = opts.data as Record<string, unknown>;

    const nests = type.kind === "object" || type.kind === "array";
    if (nests) {
      if (!field.children?.length) {
        ctx.issues.push({ path: `${at}.children`, message: "Add at least one nested field" });
      } else if (level + 1 > MAX_NESTING) {
        ctx.issues.push({ path: `${at}.children`, message: `Nesting deeper than ${MAX_NESTING} levels is not allowed` });
      } else {
        checkFields(field.children, `${at}.children`, level + 1, ctx);
      }
    } else if (field.children?.length) {
      ctx.issues.push({ path: `${at}.children`, message: "Only object and array fields can have nested fields" });
    }

    if (type.kind === "formula") {
      try {
        const { refs } = compileFormula(options.expression as string);
        const siblings = new Set(fields.map((f) => f.name));
        const unknown = refs.filter((r) => !siblings.has(r));
        for (const name of unknown) ctx.issues.push({ path: `${at}.options.expression`, message: `Unknown field "${name}"` });
        // A duplicate name is already reported; keeping it out of the plan avoids ambiguous lookups.
        if (!unknown.length && !duplicate) formulas.push({ name: field.name, refs, index: i });
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        ctx.issues.push({ path: `${at}.options.expression`, message: e.message });
      }
    }

    if (type.kind === "reference") checkReference(options as { schemaId: string; fieldName: string }, at, ctx);
  });

  try {
    formulaOrder(formulas);
  } catch (e) {
    if (!(e instanceof FormulaCycleError)) throw e;
    const first = formulas.find((f) => e.cycle.includes(f.name))!;
    ctx.issues.push({ path: `${path}[${first.index}].options.expression`, message: e.message });
  }
}

function checkReference(o: { schemaId: string; fieldName: string }, at: string, ctx: Ctx): void {
  if (o.schemaId === ctx.schema.id) {
    ctx.issues.push({ path: `${at}.options.schemaId`, message: "A schema cannot reference itself" });
    return;
  }
  const target = ctx.set.find((s) => s.id === o.schemaId);
  if (!target) {
    ctx.issues.push({ path: `${at}.options.schemaId`, message: "Referenced schema does not exist" });
    return;
  }
  const field = target.fields.find((f) => f.name === o.fieldName);
  if (!field) {
    ctx.issues.push({ path: `${at}.options.fieldName`, message: `Schema "${target.slug}" has no top-level field "${o.fieldName}"` });
  } else if (field.type === "object" || field.type === "array") {
    ctx.issues.push({ path: `${at}.options.fieldName`, message: "Cannot reference an object or array field" });
  }
}

// "fields[0].options" → ["fields", 0, "options"], so zod sub-paths can be appended.
function splitPath(path: string): PropertyKey[] {
  return path.split(/\.|\[|\]/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}
