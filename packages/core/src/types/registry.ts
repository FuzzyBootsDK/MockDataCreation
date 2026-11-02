import type { Faker } from "@faker-js/faker";
import { z } from "zod";
import type { ColumnType } from "../columns.ts";

export type FieldKind = "value" | "formula" | "reference" | "object" | "array";

export interface GenContext {
  faker: Faker;
  rowIndex: number;
}

export interface FieldType {
  key: string;
  category: string;
  label: string;
  kind: FieldKind;
  options: z.ZodObject;
  column(options: any): ColumnType;
  generate(options: any, ctx: GenContext): unknown;
}

export function defineType<S extends z.ZodObject>(def: {
  key: string;
  category: string;
  label: string;
  kind?: FieldKind;
  options?: S;
  column: ColumnType | ((options: z.output<S>) => ColumnType);
  generate?: (options: z.output<S>, ctx: GenContext) => unknown;
}): FieldType {
  const column = def.column;
  return {
    key: def.key,
    category: def.category,
    label: def.label,
    kind: def.kind ?? "value",
    options: def.options ?? z.object({}),
    column: typeof column === "function" ? column : () => column,
    generate: def.generate ?? (() => null),
  };
}
