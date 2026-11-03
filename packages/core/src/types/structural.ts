import { faker } from "@faker-js/faker";
import { z } from "zod";
import { COLUMN_TYPES } from "../columns.ts";
import { defineType, type FieldType } from "./registry.ts";

const MAX_QUANTIFIER = 1000;

// Checks run in order and stop at the first failure.
const validRegex = z.string().min(1).superRefine((p, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  try {
    new RegExp(p);
  } catch {
    return fail("Not a valid regular expression");
  }
  for (const m of p.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    if (Number(m[1]) > MAX_QUANTIFIER || Number(m[2] ?? 0) > MAX_QUANTIFIER) {
      return fail("Quantifiers above 1000 are not allowed");
    }
  }
  try {
    faker.helpers.fromRegExp(p);
  } catch {
    return fail("Pattern is not supported for generation");
  }
});

export const structuralTypes: FieldType[] = [
  defineType({
    key: "rowNumber",
    category: "Basic",
    label: "Row Number",
    options: z.object({ start: z.number().int().default(1) }),
    column: "bigint",
    generate: (o, ctx) => o.start + ctx.rowIndex,
  }),
  defineType({
    key: "uuid",
    category: "Basic",
    label: "UUID",
    column: "uuid",
    generate: (_o, ctx) => ctx.faker.string.uuid(),
  }),
  defineType({
    key: "number",
    category: "Basic",
    label: "Number",
    options: z
      .object({
        min: z.number().default(0),
        max: z.number().default(1000),
        decimals: z.number().int().min(0).max(10).default(0),
      })
      .refine((o) => o.min <= o.max, { message: "min must be less than or equal to max", path: ["min"] })
      .refine((o) => o.decimals !== 0 || o.min > o.max || Math.ceil(o.min) <= Math.floor(o.max), {
        message: "min..max contains no whole number; widen the range or set decimals",
        path: ["min"],
      }),
    column: (o) => (o.decimals === 0 ? "bigint" : "decimal"),
    generate: (o, ctx) =>
      o.decimals === 0
        ? ctx.faker.number.int({ min: Math.ceil(o.min), max: Math.floor(o.max) })
        : ctx.faker.number.float({ min: o.min, max: o.max, fractionDigits: o.decimals }),
  }),
  defineType({
    key: "boolean",
    category: "Basic",
    label: "Boolean",
    options: z.object({ truePercent: z.number().min(0).max(100).default(50) }),
    column: "bool",
    generate: (o, ctx) => ctx.faker.datatype.boolean({ probability: o.truePercent / 100 }),
  }),
  defineType({
    key: "customList",
    category: "Basic",
    label: "Custom List",
    options: z.object({
      values: z
        .array(z.object({ value: z.string(), weight: z.number().positive().default(1) }))
        .min(1, "Add at least one value"),
    }),
    column: "text",
    generate: (o, ctx) => ctx.faker.helpers.weightedArrayElement(o.values),
  }),
  defineType({
    key: "regex",
    category: "Basic",
    label: "Regular Expression",
    options: z.object({ pattern: validRegex }),
    column: "text",
    generate: (o, ctx) => ctx.faker.helpers.fromRegExp(o.pattern),
  }),
  defineType({
    key: "formula",
    category: "Advanced",
    label: "Formula",
    kind: "formula",
    options: z.object({
      expression: z.string().min(1, "Enter an expression"),
      column: z.enum(COLUMN_TYPES).default("text"),
    }),
    column: (o) => o.column,
  }),
  defineType({
    key: "reference",
    category: "Advanced",
    label: "Reference (another schema)",
    kind: "reference",
    options: z.object({
      schemaId: z.string().min(1, "Choose a schema"),
      fieldName: z.string().min(1, "Choose a field"),
    }),
    // Resolved to the target field's column type by flattenColumns.
    column: "text",
  }),
  defineType({
    key: "object",
    category: "Advanced",
    label: "JSON Object (nested fields)",
    kind: "object",
    column: "json",
  }),
  defineType({
    key: "array",
    category: "Advanced",
    label: "JSON Array (repeated nested fields)",
    kind: "array",
    options: z
      .object({
        minItems: z.number().int().min(0).max(100).default(1),
        maxItems: z.number().int().min(0).max(100).default(3),
      })
      .refine((o) => o.minItems <= o.maxItems, { message: "minItems must be ≤ maxItems", path: ["minItems"] }),
    column: "json",
  }),
];
