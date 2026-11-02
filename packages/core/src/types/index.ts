import { z } from "zod";
import type { FieldKind, FieldType } from "./registry.ts";
import { structuralTypes } from "./structural.ts";

export type { FieldKind, FieldType, GenContext } from "./registry.ts";

export const fieldTypes: readonly FieldType[] = [...structuralTypes];

const byKey = new Map(fieldTypes.map((t) => [t.key, t]));

export function getFieldType(key: string): FieldType | undefined {
  return byKey.get(key);
}

export interface FieldTypeInfo {
  key: string;
  category: string;
  label: string;
  kind: FieldKind;
  optionsSchema: unknown;
}

export function describeFieldTypes(): FieldTypeInfo[] {
  return fieldTypes.map((t) => ({
    key: t.key,
    category: t.category,
    label: t.label,
    kind: t.kind,
    optionsSchema: z.toJSONSchema(t.options, { io: "input" }),
  }));
}
