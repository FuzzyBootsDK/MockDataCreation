import type { Field, Schema, ValidationIssue } from "@mockgen/core";

export type FieldPath = number[];

function mapList(fields: Field[], parent: FieldPath, fn: (list: Field[]) => Field[]): Field[] {
  if (parent.length === 0) return fn(fields);
  const [head, ...rest] = parent;
  return fields.map((f, i) => (i === head ? { ...f, children: mapList(f.children ?? [], rest, fn) } : f));
}

export function getAt(fields: Field[], path: FieldPath): Field | undefined {
  let list = fields;
  let found: Field | undefined;
  for (const i of path) {
    found = list[i];
    if (!found) return undefined;
    list = found.children ?? [];
  }
  return found;
}

export function updateAt(fields: Field[], path: FieldPath, patch: Partial<Field>): Field[] {
  const index = path.at(-1)!;
  return mapList(fields, path.slice(0, -1), (list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
}

export function removeAt(fields: Field[], path: FieldPath): Field[] {
  const index = path.at(-1)!;
  return mapList(fields, path.slice(0, -1), (list) => list.filter((_, i) => i !== index));
}

export function appendTo(fields: Field[], parent: FieldPath, field: Field): Field[] {
  return mapList(fields, parent, (list) => [...list, field]);
}

export function moveWithin(fields: Field[], parent: FieldPath, from: number, to: number): Field[] {
  return mapList(fields, parent, (list) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  });
}

export function newField(siblings: Field[]): Field {
  let n = 1;
  while (siblings.some((f) => f.name === `field_${n}`)) n++;
  return { name: `field_${n}`, type: "person.firstName", options: {}, blankPercent: 0 };
}

export function pathString(path: FieldPath): string {
  return path.map((i, depth) => `${depth === 0 ? "fields" : ".children"}[${i}]`).join("");
}

// Issues for one field, keyed by the rest of the path ("name", "options.min", "children").
export function issuesAt(issues: ValidationIssue[], path: FieldPath): Record<string, string> {
  const prefix = `${pathString(path)}.`;
  const out: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue.path.startsWith(prefix)) continue;
    const key = issue.path.slice(prefix.length);
    if (!key.startsWith("children[")) out[key] ??= issue.message;
  }
  return out;
}

const DANISH: Record<string, string> = { æ: "ae", ø: "o", å: "a" };

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[æøå]/g, (c) => DANISH[c]!)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function directRefs(fields: Field[], out: string[] = []): string[] {
  for (const f of fields) {
    const id = f.options.schemaId;
    if (f.type === "reference" && typeof id === "string" && !out.includes(id)) out.push(id);
    if (f.children) directRefs(f.children, out);
  }
  return out;
}

export function referencedIds(schema: Schema, all: Schema[]): string[] {
  const out: string[] = [];
  const visit = (s: Schema) => {
    for (const id of directRefs(s.fields)) {
      const dep = all.find((x) => x.id === id);
      if (!dep || out.includes(id) || id === schema.id) continue;
      visit(dep);
      out.push(id);
    }
  };
  visit(schema);
  return out;
}
