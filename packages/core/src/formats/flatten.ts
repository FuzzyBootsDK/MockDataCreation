import type { ColumnType } from "../columns.ts";
import type { Field, Row, Schema } from "../model.ts";
import { getFieldType } from "../types/index.ts";

export interface Column {
  name: string;
  type: ColumnType;
  path: string[];
}

function columnType(field: Field, schemas: Schema[], depth = 0): ColumnType {
  const type = getFieldType(field.type);
  if (!type) throw new Error(`Unknown field type: ${field.type}`);
  if (type.kind === "reference" && depth < 10) {
    const { schemaId, fieldName } = field.options as { schemaId: string; fieldName: string };
    const target = schemas.find((s) => s.id === schemaId)?.fields.find((f) => f.name === fieldName);
    return target ? columnType(target, schemas, depth + 1) : "text";
  }
  return type.column(type.options.parse(field.options));
}

export function flattenColumns(fields: Field[], schemas: Schema[], prefix: string[] = []): Column[] {
  return fields.flatMap((field): Column[] => {
    const path = [...prefix, field.name];
    if (field.type === "object") return flattenColumns(field.children ?? [], schemas, path);
    const type = field.type === "array" ? "json" : columnType(field, schemas);
    return [{ name: path.join("_"), type, path }];
  });
}

export function flattenRow(row: Row, columns: Column[]): unknown[] {
  return columns.map((c) => {
    let v: unknown = row;
    for (const key of c.path) v = v != null && typeof v === "object" ? (v as Row)[key] : null;
    if (v === undefined) v = null;
    return c.type === "json" && v != null ? JSON.stringify(v) : v;
  });
}
