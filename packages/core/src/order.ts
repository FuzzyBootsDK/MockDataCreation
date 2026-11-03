import type { Field, Schema } from "./model.ts";

function collectRefs(fields: Field[], out: string[]) {
  for (const f of fields) {
    if (f.type === "reference") {
      const id = f.options.schemaId;
      if (typeof id === "string" && !out.includes(id)) out.push(id);
    }
    if (f.children) collectRefs(f.children, out);
  }
}

export function referencedSchemaIds(schema: Schema): string[] {
  const out: string[] = [];
  collectRefs(schema.fields, out);
  return out;
}

// Top-level field names of `schema` that reference `targetId`, deduplicated.
export function referencedFieldNames(schema: Schema, targetId: string): string[] {
  const out: string[] = [];
  const walk = (fields: Field[]) => {
    for (const f of fields) {
      if (f.type === "reference" && f.options.schemaId === targetId && typeof f.options.fieldName === "string") {
        if (!out.includes(f.options.fieldName)) out.push(f.options.fieldName);
      }
      if (f.children) walk(f.children);
    }
  };
  walk(schema.fields);
  return out;
}

export function findReferenceCycle(schemas: Schema[], startId: string): string[] | null {
  const byId = new Map(schemas.map((s) => [s.id, s]));
  const path: string[] = [];
  const done = new Set<string>();
  const visit = (id: string): string[] | null => {
    const at = path.indexOf(id);
    if (at >= 0) return [...path.slice(at), id];
    if (done.has(id)) return null;
    const s = byId.get(id);
    if (!s) return null;
    path.push(id);
    for (const dep of referencedSchemaIds(s)) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(id);
    return null;
  };
  return visit(startId);
}

export function withDependencies(schemas: Schema[], ids: string[]): string[] {
  const byId = new Map(schemas.map((s) => [s.id, s]));
  const out: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (out.includes(id)) return;
    const s = byId.get(id);
    if (!s) throw new Error(`Unknown schema: ${id}`);
    if (visiting.has(id)) throw new Error(`Circular reference involving schema: ${id}`);
    visiting.add(id);
    for (const dep of referencedSchemaIds(s)) visit(dep);
    visiting.delete(id);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out;
}
