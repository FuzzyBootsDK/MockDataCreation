import { z } from "zod";
import { createFaker } from "../engine/fakers.ts";
import type { FieldKind, FieldType } from "./registry.ts";
import { structuralTypes } from "./structural.ts";
import { fakerCatalog } from "./faker-catalog.ts";

export type { FieldKind, FieldType, GenContext } from "./registry.ts";

export const fieldTypes: readonly FieldType[] = [...structuralTypes, ...fakerCatalog];

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
  description?: string;
  /** Three sample values with default options, for the type picker; empty when the type needs options first. */
  examples: string[];
}

const EXAMPLE_COUNT = 3;
const EXAMPLE_MAX_LENGTH = 60;

function exampleValues(t: FieldType, seed: number): string[] {
  if (t.kind !== "value" || t.description) return [];
  const parsed = t.options.safeParse({});
  if (!parsed.success) return [];
  const faker = createFaker("en");
  faker.seed(seed);
  return Array.from({ length: EXAMPLE_COUNT }, (_, rowIndex) => {
    const s = String(t.generate(parsed.data, { faker, rowIndex })).replace(/\s+/g, " ");
    return s.length > EXAMPLE_MAX_LENGTH ? `${s.slice(0, EXAMPLE_MAX_LENGTH - 1)}…` : s;
  });
}

export function describeFieldTypes(): FieldTypeInfo[] {
  return fieldTypes.map((t, i) => ({
    key: t.key,
    category: t.category,
    label: t.label,
    kind: t.kind,
    optionsSchema: z.toJSONSchema(t.options, { io: "input" }),
    description: t.description,
    examples: exampleValues(t, i + 1),
  }));
}
