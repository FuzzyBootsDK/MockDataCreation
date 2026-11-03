import { z } from "zod";

export const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_NESTING = 5;
export const MAX_DEFAULT_COUNT = 1_000_000;
export const MAX_ARRAY_VALUES_PER_ROW = 10_000;
export const MAX_FORMULA_TEXT = 65_536;

export const FieldSchema = z.object({
  name: z.string().regex(FIELD_NAME, "Use letters, digits and _; must not start with a digit"),
  type: z.string().min(1, "Choose a type"),
  options: z.record(z.string(), z.unknown()).default({}),
  blankPercent: z.number().min(0).max(100).default(0),
  get children(): z.ZodOptional<z.ZodArray<typeof FieldSchema>> {
    return z.array(FieldSchema).optional();
  },
});

export const SchemaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Enter a name").max(200),
  slug: z.string().regex(SLUG, "Use lowercase letters, digits and single dashes"),
  locale: z.string().default("en"),
  defaultCount: z.number().int().min(1).max(MAX_DEFAULT_COUNT).default(100),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1),
  mockEnabled: z.boolean().default(false),
  fields: z.array(FieldSchema).min(1, "Add at least one field"),
});

export type Field = z.infer<typeof FieldSchema>;
export type Schema = z.infer<typeof SchemaSchema>;
export type SchemaInput = z.input<typeof SchemaSchema>;
export type Row = Record<string, unknown>;
