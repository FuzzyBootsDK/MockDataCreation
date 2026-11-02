# mockgen Part 1: Core Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@mockgen/core`, a pure TypeScript library that validates mock-data schemas, generates deterministic rows (field types, blank %, formulas, references, nesting), and formats them as CSV, JSON, NDJSON or SQL.

**Architecture:** pnpm monorepo. `packages/core` has no I/O; it exposes a `DataGenerator` class (row-by-index, deterministic per seed), `validateSchema`, `withDependencies`, and streaming formatters (sync generators of string chunks). Node runs `.ts` files directly (type stripping), so there is no build step; `tsc` is used only for type checking.

**Tech Stack:** Node 24+ (local: 25.9), pnpm 11, TypeScript 7 (type check only), Vitest 5, Zod 4, @faker-js/faker 10, jsep 1.6.

**Spec:** `docs/superpowers/specs/2026-11-02-mockgen-design.md`

**Plan series:** Part 1 Core (this) → Part 2 Server → Part 3 Seeding → Part 4 Web UI & Docker. Each part ends with working, tested software.

## Global Constraints

- All source is ESM TypeScript with **erasable syntax only** (no `enum`, no `namespace`, no constructor parameter properties). Relative imports use the `.ts` extension.
- Package versions (pin exactly as listed): `@faker-js/faker` 10.6.0, `jsep` 1.6.0, `zod` 4.6.7, `typescript` 7.0.2, `vitest` 5.0.5, `@types/node` latest 24.x.
- Formula evaluation must never use `eval`, `new Function`, or `expr-eval` (unmaintained, open code-execution advisories). Use `jsep` to parse and the whitelisted evaluator in this plan.
- Faker instances use a fixed reference date `2026-01-01T00:00:00.000Z` so output is identical across days.
- Limits from spec: nesting depth ≤ 5, `defaultCount` 1–1,000,000, `blankPercent` 0–100.
- Column naming for flattened output: nested keys joined with `_` (`address.city` → `address_city`); arrays serialized as JSON text.
- Run all commands from the repository root: `C:\Users\lasr\OneDrive\Projects\Mockaroo Lookalike` (Git Bash paths work too).

## File Structure

```
package.json                      root scripts (test, typecheck)
pnpm-workspace.yaml               workspace + allowBuilds policy
tsconfig.base.json                shared compiler options
.gitignore
packages/core/
  package.json                    exports ./src/index.ts
  tsconfig.json
  vitest.config.ts
  src/index.ts                    public API barrel
  src/rng.ts                      hashSeed + Rng (mulberry32)
  src/model.ts                    Zod Schema/Field model, Row type
  src/columns.ts                  ColumnType, Dialect, SQL type mapping
  src/types/registry.ts           FieldType interface + defineType
  src/types/dates.ts              date option + formatting helpers
  src/types/structural.ts         rowNumber, uuid, number, boolean, customList, regex, formula, reference, object, array
  src/types/faker-catalog.ts      ~100 faker-backed types
  src/types/index.ts              registry lookup + describeFieldTypes()
  src/engine/fakers.ts            locale-aware Faker factory
  src/formula/helpers.ts          whitelisted helper functions
  src/formula/compile.ts          jsep parse + syntax whitelist + refs
  src/formula/evaluate.ts         AST evaluator
  src/engine/plan.ts              per-field-list execution plan, formula topo order
  src/engine/generator.ts         DataGenerator
  src/validate.ts                 validateSchema → issues
  src/order.ts                    referencedSchemaIds, withDependencies, findReferenceCycle
  src/formats/flatten.ts          flattenColumns, flattenRow
  src/formats/csv.ts
  src/formats/json.ts
  src/formats/sql.ts
  src/formats/index.ts            formatRows, Format
  test/*.test.ts
```

---

### Task 1: Workspace scaffold and seeded RNG

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/rng.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/rng.test.ts`

**Interfaces:**
- Produces: `hashSeed(...parts: (string | number)[]): number` (unsigned 32-bit); `class Rng { constructor(seed: number); next(): number /* [0,1) */; int(min: number, max: number): number /* inclusive */; chance(percent: number): boolean }`

- [ ] **Step 1: Create root workspace files**

`package.json`:
```json
{
  "name": "mockgen",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.21.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
# better-sqlite3 ships prebuilt binaries; its node-gyp fallback script is not needed.
allowBuilds:
  better-sqlite3: false
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

`.gitignore`:
```
node_modules/
dist/
data/
test-results/
playwright-report/
*.db
```

- [ ] **Step 2: Create the core package**

`packages/core/package.json`:
```json
{
  "name": "@mockgen/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@faker-js/faker": "10.6.0",
    "jsep": "1.6.0",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "7.0.2",
    "vitest": "5.0.5"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

Run: `pnpm install`
Expected: completes with exit code 0 and creates `pnpm-lock.yaml`.

- [ ] **Step 3: Write the failing RNG test**

`packages/core/test/rng.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { Rng, hashSeed } from "../src/rng.ts";

describe("hashSeed", () => {
  test("is stable and unsigned 32-bit", () => {
    const a = hashSeed(42, "schema-a", 7);
    expect(a).toBe(hashSeed(42, "schema-a", 7));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  test("differs when any part differs", () => {
    const base = hashSeed(42, "schema-a", 7);
    expect(hashSeed(43, "schema-a", 7)).not.toBe(base);
    expect(hashSeed(42, "schema-b", 7)).not.toBe(base);
    expect(hashSeed(42, "schema-a", 8)).not.toBe(base);
  });

  test("part boundaries matter", () => {
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
  });
});

describe("Rng", () => {
  test("same seed gives same sequence", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("next is in [0, 1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int is inclusive and covers the range", () => {
    const r = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  test("chance respects 0 and 100", () => {
    const r = new Rng(5);
    for (let i = 0; i < 100; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(100)).toBe(true);
    }
  });

  test("chance(30) is roughly 30%", () => {
    const r = new Rng(77);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (r.chance(30)) hits++;
    expect(hits).toBeGreaterThan(2_700);
    expect(hits).toBeLessThan(3_300);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @mockgen/core test`
Expected: FAIL, "Failed to resolve import ../src/rng.ts" (or similar module-not-found error).

- [ ] **Step 5: Implement the RNG**

`packages/core/src/rng.ts`:
```ts
// FNV-1a over the parts joined with a NUL separator, so ("ab","c") and ("a","bc") differ.
export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join("\u0000");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for test data.
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(percent: number): boolean {
    return percent > 0 && this.next() * 100 < percent;
  }
}
```

`packages/core/src/index.ts`:
```ts
export { Rng, hashSeed } from "./rng.ts";
```

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @mockgen/core test && pnpm --filter @mockgen/core typecheck`
Expected: all rng tests PASS; `tsc` prints nothing and exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore packages/core
git commit -m "feat(core): scaffold workspace and seeded RNG"
```

---

### Task 2: Schema model, column types, field-type registry and structural types

**Files:**
- Create: `packages/core/src/model.ts`, `packages/core/src/columns.ts`
- Create: `packages/core/src/types/registry.ts`, `packages/core/src/types/dates.ts`, `packages/core/src/types/structural.ts`, `packages/core/src/types/index.ts`
- Create: `packages/core/src/engine/fakers.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/model.test.ts`, `packages/core/test/structural.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `FieldSchema`, `SchemaSchema` (Zod); `type Field = { name: string; type: string; options: Record<string, unknown>; blankPercent: number; children?: Field[] }`; `type Schema = { id; name; slug; locale; defaultCount; seed; mockEnabled; fields: Field[] }`; `type SchemaInput = z.input<typeof SchemaSchema>`; `type Row = Record<string, unknown>`; `MAX_NESTING = 5`.
  - `type Dialect = "pg" | "mssql" | "sqlite"`; `DIALECTS`; `type ColumnType = "text" | "int" | "bigint" | "decimal" | "bool" | "date" | "datetime" | "uuid" | "json"`; `COLUMN_TYPES`; `columnSql(type, dialect): string`.
  - `type FieldKind = "value" | "formula" | "reference" | "object" | "array"`; `interface GenContext { faker: Faker; rowIndex: number }`; `interface FieldType { key; category; label; kind; options: z.ZodObject; column(options: any): ColumnType; generate(options: any, ctx: GenContext): unknown }`; `defineType(def): FieldType`.
  - `formatDate(d: Date, format: "datetime" | "date"): string`; `DateFormatOption` (Zod).
  - `getFieldType(key): FieldType | undefined`; `fieldTypes: readonly FieldType[]`; `describeFieldTypes(): FieldTypeInfo[]` where `FieldTypeInfo = { key; category; label; kind; optionsSchema: unknown /* JSON Schema */ }`.
  - `REF_DATE`, `LOCALES: string[]`, `isKnownLocale(code): boolean`, `createFaker(locale): Faker`.

- [ ] **Step 1: Add dependencies (already in package.json). Write failing model and structural tests**

`packages/core/test/model.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema } from "../src/model.ts";
import { columnSql } from "../src/columns.ts";

describe("SchemaSchema", () => {
  test("applies defaults", () => {
    const s = SchemaSchema.parse({
      id: "s1",
      name: "Customers",
      slug: "customers",
      fields: [{ name: "id", type: "rowNumber" }],
    });
    expect(s.locale).toBe("en");
    expect(s.defaultCount).toBe(100);
    expect(s.seed).toBe(1);
    expect(s.mockEnabled).toBe(false);
    expect(s.fields[0]).toEqual({ name: "id", type: "rowNumber", options: {}, blankPercent: 0 });
  });

  test("parses nested children", () => {
    const s = SchemaSchema.parse({
      id: "s1",
      name: "X",
      slug: "x",
      fields: [{ name: "address", type: "object", children: [{ name: "city", type: "location.city" }] }],
    });
    expect(s.fields[0]?.children?.[0]?.name).toBe("city");
  });

  test("rejects bad slug and field name", () => {
    const r = SchemaSchema.safeParse({
      id: "s1",
      name: "X",
      slug: "Bad Slug",
      fields: [{ name: "1abc", type: "uuid" }],
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("slug");
    expect(paths).toContain("fields.0.name");
  });

  test("rejects empty field list and out-of-range blankPercent", () => {
    expect(SchemaSchema.safeParse({ id: "s", name: "X", slug: "x", fields: [] }).success).toBe(false);
    expect(
      SchemaSchema.safeParse({ id: "s", name: "X", slug: "x", fields: [{ name: "a", type: "uuid", blankPercent: 101 }] })
        .success,
    ).toBe(false);
  });
});

describe("columnSql", () => {
  test("maps per dialect", () => {
    expect(columnSql("uuid", "pg")).toBe("uuid");
    expect(columnSql("uuid", "mssql")).toBe("uniqueidentifier");
    expect(columnSql("uuid", "sqlite")).toBe("TEXT");
    expect(columnSql("bool", "mssql")).toBe("bit");
    expect(columnSql("datetime", "pg")).toBe("timestamp");
  });
});
```

`packages/core/test/structural.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { getFieldType, describeFieldTypes } from "../src/types/index.ts";
import { createFaker } from "../src/engine/fakers.ts";

function gen(key: string, options: Record<string, unknown> = {}, rowIndex = 0, seed = 1) {
  const type = getFieldType(key)!;
  const faker = createFaker("en");
  faker.seed(seed);
  return type.generate(type.options.parse(options), { faker, rowIndex });
}

describe("structural types", () => {
  test("rowNumber starts at option start", () => {
    expect(gen("rowNumber", {}, 0)).toBe(1);
    expect(gen("rowNumber", { start: 100 }, 4)).toBe(104);
  });

  test("uuid is deterministic for a seed", () => {
    const a = gen("uuid", {}, 0, 5);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(gen("uuid", {}, 0, 5)).toBe(a);
  });

  test("number respects range and decimals", () => {
    for (let s = 0; s < 50; s++) {
      const n = gen("number", { min: 10, max: 20, decimals: 0 }, 0, s) as number;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(20);
      const f = gen("number", { min: 0, max: 1, decimals: 2 }, 0, s) as number;
      expect(Math.round(f * 100) / 100).toBe(f);
    }
  });

  test("number rejects min > max", () => {
    expect(getFieldType("number")!.options.safeParse({ min: 5, max: 1 }).success).toBe(false);
  });

  test("boolean truePercent 0 and 100", () => {
    expect(gen("boolean", { truePercent: 0 })).toBe(false);
    expect(gen("boolean", { truePercent: 100 })).toBe(true);
  });

  test("customList picks from values", () => {
    const values = [{ value: "a", weight: 1 }, { value: "b", weight: 3 }];
    for (let s = 0; s < 20; s++) expect(["a", "b"]).toContain(gen("customList", { values }, 0, s));
  });

  test("customList requires at least one value", () => {
    expect(getFieldType("customList")!.options.safeParse({ values: [] }).success).toBe(false);
  });

  test("regex generates matching strings", () => {
    const v = gen("regex", { pattern: "[A-Z]{3}-[0-9]{4}" }) as string;
    expect(v).toMatch(/^[A-Z]{3}-[0-9]{4}$/);
  });

  test("regex rejects invalid pattern", () => {
    expect(getFieldType("regex")!.options.safeParse({ pattern: "([" }).success).toBe(false);
  });

  test("column types depend on options", () => {
    const num = getFieldType("number")!;
    expect(num.column(num.options.parse({ decimals: 0 }))).toBe("bigint");
    expect(num.column(num.options.parse({ decimals: 2 }))).toBe("decimal");
    const formula = getFieldType("formula")!;
    expect(formula.column(formula.options.parse({ expression: "1", column: "int" }))).toBe("int");
  });

  test("kinds", () => {
    expect(getFieldType("formula")!.kind).toBe("formula");
    expect(getFieldType("reference")!.kind).toBe("reference");
    expect(getFieldType("object")!.kind).toBe("object");
    expect(getFieldType("array")!.kind).toBe("array");
    expect(getFieldType("uuid")!.kind).toBe("value");
  });

  test("describeFieldTypes returns JSON Schema for options", () => {
    const info = describeFieldTypes().find((t) => t.key === "number")!;
    expect(info.category).toBe("Basic");
    expect(info.optionsSchema).toMatchObject({ type: "object", properties: { min: { type: "number" } } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mockgen/core test`
Expected: FAIL with module-not-found for `../src/model.ts` and `../src/types/index.ts`.

- [ ] **Step 3: Implement model and columns**

`packages/core/src/model.ts`:
```ts
import { z } from "zod";

export const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_NESTING = 5;
export const MAX_DEFAULT_COUNT = 1_000_000;

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
  name: z.string().min(1).max(200),
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
```

`packages/core/src/columns.ts`:
```ts
export type Dialect = "pg" | "mssql" | "sqlite";
export const DIALECTS: readonly Dialect[] = ["pg", "mssql", "sqlite"];

export type ColumnType = "text" | "int" | "bigint" | "decimal" | "bool" | "date" | "datetime" | "uuid" | "json";
export const COLUMN_TYPES: readonly ColumnType[] = [
  "text", "int", "bigint", "decimal", "bool", "date", "datetime", "uuid", "json",
];

const SQL_TYPES: Record<Dialect, Record<ColumnType, string>> = {
  pg: {
    text: "text", int: "integer", bigint: "bigint", decimal: "numeric", bool: "boolean",
    date: "date", datetime: "timestamp", uuid: "uuid", json: "jsonb",
  },
  mssql: {
    text: "nvarchar(max)", int: "int", bigint: "bigint", decimal: "decimal(18,4)", bool: "bit",
    date: "date", datetime: "datetime2", uuid: "uniqueidentifier", json: "nvarchar(max)",
  },
  sqlite: {
    text: "TEXT", int: "INTEGER", bigint: "INTEGER", decimal: "REAL", bool: "INTEGER",
    date: "TEXT", datetime: "TEXT", uuid: "TEXT", json: "TEXT",
  },
};

export function columnSql(type: ColumnType, dialect: Dialect): string {
  return SQL_TYPES[dialect][type];
}
```

- [ ] **Step 4: Implement the registry, dates and faker factory**

`packages/core/src/types/registry.ts`:
```ts
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
```

`packages/core/src/types/dates.ts`:
```ts
import { z } from "zod";

export const DateFormatOption = z.enum(["datetime", "date"]).default("datetime");
export type DateFormat = z.output<typeof DateFormatOption>;

export function formatDate(d: Date, format: DateFormat): string {
  const iso = d.toISOString();
  return format === "date" ? iso.slice(0, 10) : iso;
}

export const isoDateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date");
```

`packages/core/src/engine/fakers.ts`:
```ts
import { Faker, allLocales, base, en, type LocaleDefinition } from "@faker-js/faker";

// Fixed so relative dates (past/future/birthdate) do not drift from day to day.
export const REF_DATE = "2026-01-01T00:00:00.000Z";

const locales = allLocales as Record<string, LocaleDefinition>;

export const LOCALES: string[] = Object.keys(locales).filter((k) => k !== "base").sort();

export function isKnownLocale(code: string): boolean {
  return Object.hasOwn(locales, code) && code !== "base";
}

export function createFaker(locale: string): Faker {
  const def = isKnownLocale(locale) ? locales[locale]! : en;
  const faker = new Faker({ locale: [def, en, base] });
  faker.setDefaultRefDate(REF_DATE);
  return faker;
}
```

- [ ] **Step 5: Implement the structural types**

`packages/core/src/types/structural.ts`:
```ts
import { z } from "zod";
import { COLUMN_TYPES } from "../columns.ts";
import { defineType, type FieldType } from "./registry.ts";

const validRegex = z.string().min(1).refine((p) => {
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}, "Not a valid regular expression");

export const structuralTypes: FieldType[] = [
  defineType({
    key: "rowNumber",
    category: "Basic",
    label: "Row number",
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
      .refine((o) => o.min <= o.max, { message: "min must be less than or equal to max", path: ["min"] }),
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
    label: "Custom list",
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
    label: "Regular expression",
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
    label: "Reference to another schema",
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
    label: "Object (nested fields)",
    kind: "object",
    column: "json",
  }),
  defineType({
    key: "array",
    category: "Advanced",
    label: "Array (repeated nested fields)",
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
```

- [ ] **Step 6: Implement the registry index**

`packages/core/src/types/index.ts`:
```ts
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
```

Update `packages/core/src/index.ts`:
```ts
export { Rng, hashSeed } from "./rng.ts";
export * from "./model.ts";
export * from "./columns.ts";
export { fieldTypes, getFieldType, describeFieldTypes } from "./types/index.ts";
export type { FieldKind, FieldType, FieldTypeInfo, GenContext } from "./types/index.ts";
export { LOCALES, REF_DATE, isKnownLocale, createFaker } from "./engine/fakers.ts";
```

- [ ] **Step 7: Run tests and type check**

Run: `pnpm --filter @mockgen/core test && pnpm --filter @mockgen/core typecheck`
Expected: PASS for model, structural and rng tests; type check exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): schema model, column types and structural field types"
```

---

### Task 3: Faker-backed type catalog

**Files:**
- Create: `packages/core/src/types/faker-catalog.ts`
- Modify: `packages/core/src/types/index.ts` (append catalog to `fieldTypes`)
- Test: `packages/core/test/faker-catalog.test.ts`

**Interfaces:**
- Consumes: `defineType`, `GenContext` (Task 2), `formatDate`, `DateFormatOption`, `isoDateString` (Task 2), `createFaker` (Task 2).
- Produces: `fakerCatalog: FieldType[]`. Keys are the faker method path (e.g. `person.firstName`) plus `date.between`, `date.past`, `date.future`, `date.birthdate`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/faker-catalog.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { fakerCatalog } from "../src/types/faker-catalog.ts";
import { getFieldType } from "../src/types/index.ts";
import { createFaker } from "../src/engine/fakers.ts";

describe("faker catalog", () => {
  test("has at least 90 types with unique keys", () => {
    expect(fakerCatalog.length).toBeGreaterThanOrEqual(90);
    expect(new Set(fakerCatalog.map((t) => t.key)).size).toBe(fakerCatalog.length);
  });

  test.each(fakerCatalog.map((t) => [t.key, t] as const))("%s generates a scalar value", (_key, type) => {
    const faker = createFaker("en");
    faker.seed(1);
    const v = type.generate(type.options.parse({}), { faker, rowIndex: 0 });
    expect(v).not.toBeUndefined();
    expect(v).not.toBeNull();
    expect(["string", "number", "boolean"]).toContain(typeof v);
  });

  test("registered in the registry", () => {
    expect(getFieldType("person.firstName")?.category).toBe("Person");
  });

  test("date.between respects range and format", () => {
    const t = getFieldType("date.between")!;
    const faker = createFaker("en");
    faker.seed(3);
    const v = t.generate(t.options.parse({ from: "2024-01-01", to: "2024-01-31", format: "date" }), {
      faker,
      rowIndex: 0,
    }) as string;
    expect(v).toMatch(/^2024-01-\d{2}$/);
    expect(t.column(t.options.parse({ format: "date" }))).toBe("date");
  });

  test("locale changes output", () => {
    const t = getFieldType("location.city")!;
    const en = createFaker("en");
    const da = createFaker("da");
    en.seed(1);
    da.seed(1);
    const a = t.generate({}, { faker: en, rowIndex: 0 });
    const b = t.generate({}, { faker: da, rowIndex: 0 });
    expect(a).not.toBe(b);
  });

  test("relative dates are stable (fixed reference date)", () => {
    const t = getFieldType("date.past")!;
    const f1 = createFaker("en");
    f1.seed(9);
    const v = t.generate(t.options.parse({}), { faker: f1, rowIndex: 0 }) as string;
    expect(v < "2026-01-01").toBe(true);
    expect(v >= "2025-01-01").toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/core test faker-catalog`
Expected: FAIL, cannot resolve `../src/types/faker-catalog.ts`.

- [ ] **Step 3: Implement the catalog**

`packages/core/src/types/faker-catalog.ts`:
```ts
import type { Faker } from "@faker-js/faker";
import { z } from "zod";
import type { ColumnType } from "../columns.ts";
import { DateFormatOption, formatDate, isoDateString } from "./dates.ts";
import { defineType, type FieldType } from "./registry.ts";

type Entry = [path: string, label: string, column?: ColumnType];

// Each path is "<module>.<method>" on a Faker instance, called with no arguments.
const CATALOG: Record<string, Entry[]> = {
  Person: [
    ["person.firstName", "First name"],
    ["person.lastName", "Last name"],
    ["person.middleName", "Middle name"],
    ["person.fullName", "Full name"],
    ["person.prefix", "Name prefix"],
    ["person.suffix", "Name suffix"],
    ["person.sex", "Sex"],
    ["person.gender", "Gender"],
    ["person.jobTitle", "Job title"],
    ["person.jobArea", "Job area"],
    ["person.jobType", "Job type"],
    ["person.bio", "Bio"],
    ["person.zodiacSign", "Zodiac sign"],
  ],
  Internet: [
    ["internet.email", "Email"],
    ["internet.username", "Username"],
    ["internet.displayName", "Display name"],
    ["internet.password", "Password"],
    ["internet.url", "URL"],
    ["internet.domainName", "Domain name"],
    ["internet.ipv4", "IPv4 address"],
    ["internet.ipv6", "IPv6 address"],
    ["internet.mac", "MAC address"],
    ["internet.port", "Port", "int"],
    ["internet.httpMethod", "HTTP method"],
    ["internet.httpStatusCode", "HTTP status code", "int"],
    ["internet.userAgent", "User agent"],
    ["internet.emoji", "Emoji"],
  ],
  Location: [
    ["location.streetAddress", "Street address"],
    ["location.street", "Street name"],
    ["location.buildingNumber", "Building number"],
    ["location.secondaryAddress", "Secondary address"],
    ["location.city", "City"],
    ["location.state", "State"],
    ["location.county", "County"],
    ["location.zipCode", "Postal code"],
    ["location.country", "Country"],
    ["location.countryCode", "Country code"],
    ["location.latitude", "Latitude", "decimal"],
    ["location.longitude", "Longitude", "decimal"],
    ["location.timeZone", "Time zone"],
    ["location.direction", "Direction"],
  ],
  Company: [
    ["company.name", "Company name"],
    ["company.catchPhrase", "Catch phrase"],
    ["company.buzzPhrase", "Buzz phrase"],
  ],
  Finance: [
    ["finance.iban", "IBAN"],
    ["finance.bic", "BIC"],
    ["finance.accountNumber", "Account number"],
    ["finance.accountName", "Account name"],
    ["finance.routingNumber", "Routing number"],
    ["finance.creditCardNumber", "Credit card number"],
    ["finance.creditCardCVV", "Credit card CVV"],
    ["finance.creditCardIssuer", "Credit card issuer"],
    ["finance.currencyCode", "Currency code"],
    ["finance.currencyName", "Currency name"],
    ["finance.amount", "Amount"],
    ["finance.transactionType", "Transaction type"],
    ["finance.transactionDescription", "Transaction description"],
    ["finance.bitcoinAddress", "Bitcoin address"],
  ],
  Commerce: [
    ["commerce.productName", "Product name"],
    ["commerce.product", "Product"],
    ["commerce.productAdjective", "Product adjective"],
    ["commerce.productMaterial", "Product material"],
    ["commerce.productDescription", "Product description"],
    ["commerce.department", "Department"],
    ["commerce.price", "Price"],
    ["commerce.isbn", "ISBN"],
  ],
  Phone: [
    ["phone.number", "Phone number"],
    ["phone.imei", "IMEI"],
  ],
  Text: [
    ["lorem.word", "Word"],
    ["lorem.words", "Words"],
    ["lorem.sentence", "Sentence"],
    ["lorem.sentences", "Sentences"],
    ["lorem.paragraph", "Paragraph"],
    ["lorem.paragraphs", "Paragraphs"],
    ["lorem.slug", "Slug"],
    ["word.adjective", "Adjective"],
    ["word.noun", "Noun"],
    ["word.verb", "Verb"],
    ["hacker.phrase", "Hacker phrase"],
    ["hacker.abbreviation", "Tech abbreviation"],
  ],
  Vehicle: [
    ["vehicle.vehicle", "Vehicle"],
    ["vehicle.manufacturer", "Manufacturer"],
    ["vehicle.model", "Model"],
    ["vehicle.type", "Vehicle type"],
    ["vehicle.fuel", "Fuel type"],
    ["vehicle.vin", "VIN"],
    ["vehicle.vrm", "Registration mark"],
    ["vehicle.color", "Vehicle color"],
  ],
  Misc: [
    ["color.human", "Color name"],
    ["color.rgb", "Color hex"],
    ["animal.type", "Animal type"],
    ["animal.dog", "Dog breed"],
    ["animal.cat", "Cat breed"],
    ["music.genre", "Music genre"],
    ["music.songName", "Song name"],
    ["book.title", "Book title"],
    ["book.author", "Book author"],
    ["food.dish", "Dish"],
    ["food.fruit", "Fruit"],
    ["food.vegetable", "Vegetable"],
    ["airline.flightNumber", "Flight number"],
  ],
  System: [
    ["system.fileName", "File name"],
    ["system.fileExt", "File extension"],
    ["system.mimeType", "MIME type"],
    ["system.semver", "Semantic version"],
    ["system.directoryPath", "Directory path"],
    ["database.column", "Database column"],
    ["database.type", "Database type"],
    ["database.engine", "Database engine"],
    ["git.commitSha", "Git commit SHA"],
    ["git.branch", "Git branch"],
  ],
};

function callPath(faker: Faker, path: string): unknown {
  const [mod, fn] = path.split(".") as [string, string];
  const module = (faker as unknown as Record<string, Record<string, () => unknown>>)[mod]!;
  return module[fn]!.call(module);
}

const simpleTypes: FieldType[] = Object.entries(CATALOG).flatMap(([category, entries]) =>
  entries.map(([path, label, column]) =>
    defineType({
      key: path,
      category,
      label,
      column: column ?? "text",
      generate: (_o, ctx) => callPath(ctx.faker, path),
    }),
  ),
);

const dateColumn = (o: { format: "datetime" | "date" }): ColumnType => (o.format === "date" ? "date" : "datetime");

const dateTypes: FieldType[] = [
  defineType({
    key: "date.between",
    category: "Date",
    label: "Date between",
    options: z
      .object({ from: isoDateString.default("2020-01-01"), to: isoDateString.default("2030-12-31"), format: DateFormatOption })
      .refine((o) => Date.parse(o.from) <= Date.parse(o.to), { message: "from must be before to", path: ["from"] }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.between({ from: o.from, to: o.to }), o.format),
  }),
  defineType({
    key: "date.past",
    category: "Date",
    label: "Date in the past",
    options: z.object({ years: z.number().positive().max(200).default(1), format: DateFormatOption }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.past({ years: o.years }), o.format),
  }),
  defineType({
    key: "date.future",
    category: "Date",
    label: "Date in the future",
    options: z.object({ years: z.number().positive().max(200).default(1), format: DateFormatOption }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.future({ years: o.years }), o.format),
  }),
  defineType({
    key: "date.birthdate",
    category: "Date",
    label: "Birthdate",
    options: z
      .object({ minAge: z.number().int().min(0).max(120).default(18), maxAge: z.number().int().min(0).max(120).default(80) })
      .refine((o) => o.minAge <= o.maxAge, { message: "minAge must be ≤ maxAge", path: ["minAge"] }),
    column: "date",
    generate: (o, ctx) =>
      formatDate(ctx.faker.date.birthdate({ mode: "age", min: o.minAge, max: o.maxAge }), "date"),
  }),
];

export const fakerCatalog: FieldType[] = [...simpleTypes, ...dateTypes];
```

- [ ] **Step 4: Register the catalog**

In `packages/core/src/types/index.ts`, change the imports and `fieldTypes`:
```ts
import { fakerCatalog } from "./faker-catalog.ts";
// ...
export const fieldTypes: readonly FieldType[] = [...structuralTypes, ...fakerCatalog];
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @mockgen/core test faker-catalog`
Expected: PASS. If a specific `<module>.<method>` entry fails because it does not exist in faker 10.6.0 (error "is not a function" or a non-scalar return), delete that one entry from `CATALOG` (the count must stay ≥ 90) and re-run. Do not change the test.

- [ ] **Step 6: Type check and commit**

Run: `pnpm --filter @mockgen/core typecheck`
Expected: exit 0.

```bash
git add packages/core
git commit -m "feat(core): faker-backed field type catalog"
```

---

### Task 4: Formula language (compile + evaluate)

**Files:**
- Create: `packages/core/src/formula/helpers.ts`, `packages/core/src/formula/compile.ts`, `packages/core/src/formula/evaluate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/formula.test.ts`

**Interfaces:**
- Consumes: `Row` (Task 2).
- Produces:
  - `interface FormulaNode { type: string; [k: string]: unknown }`
  - `interface CompiledFormula { ast: FormulaNode; refs: string[] }` (refs = root identifiers, deduplicated, in first-seen order)
  - `class FormulaError extends Error` (compile-time), `class FormulaRuntimeError extends Error`
  - `compileFormula(source: string): CompiledFormula` (throws `FormulaError`)
  - `evaluateFormula(ast: FormulaNode, scope: Row): unknown` (throws `FormulaRuntimeError`)
  - `HELPERS: Record<string, (...args: unknown[]) => unknown>`, `HELPER_NAMES: ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

`packages/core/test/formula.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { compileFormula, FormulaError } from "../src/formula/compile.ts";
import { evaluateFormula, FormulaRuntimeError } from "../src/formula/evaluate.ts";

const run = (src: string, scope: Record<string, unknown> = {}) => evaluateFormula(compileFormula(src).ast, scope);

describe("compileFormula", () => {
  test("collects root references once, ignoring helper names", () => {
    expect(compileFormula('lower(first) + "." + lower(last) + first').refs).toEqual(["first", "last"]);
    expect(compileFormula("address.city").refs).toEqual(["address"]);
  });

  test.each([
    ["this", "ThisExpression"],
    ["a[0]", "Computed"],
    ["foo(1)", "Unknown function"],
    ["a = 1", ""],
    ["a.b()", "Only helper functions"],
    ["[1,2]", "ArrayExpression"],
    ["1 +", ""],
  ])("rejects %s", (src, msg) => {
    expect(() => compileFormula(src)).toThrow(FormulaError);
    if (msg) expect(() => compileFormula(src)).toThrow(msg);
  });
});

describe("evaluateFormula", () => {
  test("string building with helpers", () => {
    expect(run('lower(first) + "." + lower(last) + "@example.com"', { first: "Ann", last: "Lee" })).toBe(
      "ann.lee@example.com",
    );
  });

  test("arithmetic", () => {
    expect(run("qty * price", { qty: 3, price: 2.5 })).toBe(7.5);
    expect(run("round(10 / 3, 2)")).toBe(3.33);
    expect(run("-a + 1", { a: 4 })).toBe(-3);
    expect(run("7 % 3")).toBe(1);
  });

  test("null propagation", () => {
    expect(run("qty * 2", { qty: null })).toBeNull();
    expect(run('"x" + name', { name: null })).toBe("x");
    expect(run("lower(name)", { name: null })).toBeNull();
    expect(run("coalesce(a, b, 'z')", { a: null, b: null })).toBe("z");
  });

  test("comparisons, logic and if", () => {
    expect(run("if(age >= 18, 'adult', 'minor')", { age: 20 })).toBe("adult");
    expect(run("a == 1 && b != 2", { a: 1, b: 3 })).toBe(true);
    expect(run("!flag", { flag: false })).toBe(true);
    expect(run("a || 'default'", { a: "" })).toBe("default");
  });

  test("member access on nested objects only reads own properties", () => {
    expect(run("address.city", { address: { city: "Aarhus" } })).toBe("Aarhus");
    expect(run("address.constructor", { address: {} })).toBeNull();
    expect(run("address.city", { address: null })).toBeNull();
  });

  test("dateAdd keeps the input format", () => {
    expect(run("dateAdd(d, 1, 'days')", { d: "2024-01-31" })).toBe("2024-02-01");
    expect(run("dateAdd(d, 2, 'hours')", { d: "2024-01-01T00:00:00.000Z" })).toBe("2024-01-01T02:00:00.000Z");
    expect(run("dateAdd(d, 1, 'months')", { d: "2024-01-15" })).toBe("2024-02-15");
    expect(run("dateAdd(d, -1, 'years')", { d: "2024-06-01" })).toBe("2023-06-01");
  });

  test("slug, upper, trim, concat", () => {
    expect(run("slug('Hello Wörld!')")).toBe("hello-world");
    expect(run("upper(trim('  a '))")).toBe("A");
    expect(run("concat('a', 1, null, true)")).toBe("a1true");
  });

  test("runtime errors", () => {
    expect(() => run("1 / 0")).toThrow(FormulaRuntimeError);
    expect(() => run("'abc' * 2")).toThrow(FormulaRuntimeError);
    expect(() => run("dateAdd('nope', 1, 'days')")).toThrow(FormulaRuntimeError);
    expect(() => run("dateAdd('2024-01-01', 1, 'weeks')")).toThrow(FormulaRuntimeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/core test formula`
Expected: FAIL, cannot resolve `../src/formula/compile.ts`.

- [ ] **Step 3: Implement helpers**

`packages/core/src/formula/helpers.ts`:
```ts
export class FormulaRuntimeError extends Error {}

export function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : Number(String(v));
  if (Number.isNaN(n)) throw new FormulaRuntimeError(`Not a number: ${JSON.stringify(v)}`);
  return n;
}

const text = (v: unknown): string => (v == null ? "" : String(v));
const mapText = (f: (s: string) => string) => (v: unknown) => (v == null ? null : f(String(v)));

function dateAdd(date: unknown, amount: unknown, unit: unknown): string | null {
  if (date == null) return null;
  const input = String(date);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new FormulaRuntimeError(`Not a date: ${input}`);
  const n = toNumber(amount);
  switch (unit) {
    case "years": d.setUTCFullYear(d.getUTCFullYear() + n); break;
    case "months": d.setUTCMonth(d.getUTCMonth() + n); break;
    case "days": d.setUTCDate(d.getUTCDate() + n); break;
    case "hours": d.setTime(d.getTime() + n * 3_600_000); break;
    case "minutes": d.setTime(d.getTime() + n * 60_000); break;
    default: throw new FormulaRuntimeError(`Unknown unit: ${String(unit)} (use years, months, days, hours, minutes)`);
  }
  const iso = d.toISOString();
  return input.length === 10 ? iso.slice(0, 10) : iso;
}

export const HELPERS: Record<string, (...args: unknown[]) => unknown> = {
  concat: (...args) => args.map(text).join(""),
  lower: mapText((s) => s.toLowerCase()),
  upper: mapText((s) => s.toUpperCase()),
  trim: mapText((s) => s.trim()),
  slug: mapText((s) =>
    s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  ),
  if: (cond, a, b) => (cond ? a : b),
  round: (n, digits = 0) => {
    if (n == null) return null;
    const f = 10 ** toNumber(digits);
    return Math.round(toNumber(n) * f) / f;
  },
  dateAdd,
  coalesce: (...args) => args.find((v) => v != null) ?? null,
};

export const HELPER_NAMES: ReadonlySet<string> = new Set(Object.keys(HELPERS));
```

- [ ] **Step 4: Implement compile**

`packages/core/src/formula/compile.ts`:
```ts
import jsep from "jsep";
import { HELPER_NAMES } from "./helpers.ts";

export interface FormulaNode {
  type: string;
  [k: string]: unknown;
}

export interface CompiledFormula {
  ast: FormulaNode;
  refs: string[];
}

export class FormulaError extends Error {}

export const BINARY_OPERATORS: ReadonlySet<string> = new Set([
  "+", "-", "*", "/", "%", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||",
]);
export const UNARY_OPERATORS: ReadonlySet<string> = new Set(["-", "+", "!"]);

export function compileFormula(source: string): CompiledFormula {
  let ast: FormulaNode;
  try {
    ast = jsep(source) as unknown as FormulaNode;
  } catch (e) {
    throw new FormulaError((e as Error).message);
  }
  const refs: string[] = [];
  check(ast, refs);
  return { ast, refs };
}

function addRef(refs: string[], name: string) {
  if (!refs.includes(name)) refs.push(name);
}

function rootName(node: FormulaNode): string {
  let cur = node;
  while (cur.type === "MemberExpression") {
    if (cur.computed) throw new FormulaError("Computed property access (a[b]) is not allowed");
    const prop = cur.property as FormulaNode;
    if (prop.type !== "Identifier") throw new FormulaError("Only plain property names are allowed after '.'");
    cur = cur.object as FormulaNode;
  }
  if (cur.type !== "Identifier") throw new FormulaError(`Unsupported syntax: ${cur.type}`);
  return cur.name as string;
}

function check(node: FormulaNode, refs: string[]): void {
  switch (node.type) {
    case "Literal":
      return;
    case "Identifier":
      addRef(refs, node.name as string);
      return;
    case "MemberExpression":
      addRef(refs, rootName(node));
      return;
    case "UnaryExpression":
      if (!UNARY_OPERATORS.has(node.operator as string)) throw new FormulaError(`Operator not allowed: ${String(node.operator)}`);
      check(node.argument as FormulaNode, refs);
      return;
    case "BinaryExpression":
      if (!BINARY_OPERATORS.has(node.operator as string)) throw new FormulaError(`Operator not allowed: ${String(node.operator)}`);
      check(node.left as FormulaNode, refs);
      check(node.right as FormulaNode, refs);
      return;
    case "CallExpression": {
      const callee = node.callee as FormulaNode;
      if (callee.type !== "Identifier") throw new FormulaError("Only helper functions can be called, e.g. lower(x)");
      const name = callee.name as string;
      if (!HELPER_NAMES.has(name)) {
        throw new FormulaError(`Unknown function: ${name}. Available: ${[...HELPER_NAMES].join(", ")}`);
      }
      for (const arg of node.arguments as FormulaNode[]) check(arg, refs);
      return;
    }
    default:
      throw new FormulaError(`Unsupported syntax: ${node.type}`);
  }
}
```

- [ ] **Step 5: Implement evaluate**

`packages/core/src/formula/evaluate.ts`:
```ts
import type { Row } from "../model.ts";
import type { FormulaNode } from "./compile.ts";
import { FormulaRuntimeError, HELPERS, toNumber } from "./helpers.ts";

export { FormulaRuntimeError } from "./helpers.ts";

function lookup(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== "object") return null;
  return Object.hasOwn(obj, key) ? ((obj as Row)[key] ?? null) : null;
}

function arithmetic(op: string, l: unknown, r: unknown): unknown {
  if (l == null || r == null) return null;
  const a = toNumber(l);
  const b = toNumber(r);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) throw new FormulaRuntimeError("Division by zero");
      return a / b;
    case "%":
      if (b === 0) throw new FormulaRuntimeError("Division by zero");
      return a % b;
  }
  throw new FormulaRuntimeError(`Operator not allowed: ${op}`);
}

function binary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case "+":
      if (typeof l === "string" || typeof r === "string") return (l == null ? "" : String(l)) + (r == null ? "" : String(r));
      return arithmetic(op, l, r);
    case "-": case "*": case "/": case "%":
      return arithmetic(op, l, r);
    case "==": case "===": return l === r;
    case "!=": case "!==": return l !== r;
    case "<": return (l as number) < (r as number);
    case ">": return (l as number) > (r as number);
    case "<=": return (l as number) <= (r as number);
    case ">=": return (l as number) >= (r as number);
  }
  throw new FormulaRuntimeError(`Operator not allowed: ${op}`);
}

export function evaluateFormula(node: FormulaNode, scope: Row): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "Identifier":
      return lookup(scope, node.name as string);
    case "MemberExpression":
      return lookup(evaluateFormula(node.object as FormulaNode, scope), (node.property as FormulaNode).name as string);
    case "UnaryExpression": {
      const v = evaluateFormula(node.argument as FormulaNode, scope);
      if (node.operator === "!") return !v;
      if (v == null) return null;
      return node.operator === "-" ? -toNumber(v) : toNumber(v);
    }
    case "BinaryExpression": {
      const op = node.operator as string;
      const left = evaluateFormula(node.left as FormulaNode, scope);
      if (op === "&&") return left ? evaluateFormula(node.right as FormulaNode, scope) : left;
      if (op === "||") return left ? left : evaluateFormula(node.right as FormulaNode, scope);
      return binary(op, left, evaluateFormula(node.right as FormulaNode, scope));
    }
    case "CallExpression": {
      const helper = HELPERS[(node.callee as FormulaNode).name as string];
      if (!helper) throw new FormulaRuntimeError("Unknown function");
      return helper(...(node.arguments as FormulaNode[]).map((a) => evaluateFormula(a, scope)));
    }
  }
  throw new FormulaRuntimeError(`Unsupported syntax: ${node.type}`);
}
```

- [ ] **Step 6: Export from the barrel**

Append to `packages/core/src/index.ts`:
```ts
export { compileFormula, FormulaError } from "./formula/compile.ts";
export type { CompiledFormula, FormulaNode } from "./formula/compile.ts";
export { evaluateFormula, FormulaRuntimeError } from "./formula/evaluate.ts";
export { HELPER_NAMES } from "./formula/helpers.ts";
```

- [ ] **Step 7: Run tests and type check**

Run: `pnpm --filter @mockgen/core test formula && pnpm --filter @mockgen/core typecheck`
Expected: PASS; exit 0. If `"a = 1"` parses in jsep 1.6 as something other than an error, it will still be rejected by `check` (`AssignmentExpression` hits the default branch); the test only requires `FormulaError`.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): safe formula language with whitelisted helpers"
```

---

### Task 5: Execution plan and DataGenerator

**Files:**
- Create: `packages/core/src/engine/plan.ts`, `packages/core/src/engine/generator.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/generator.test.ts`

**Interfaces:**
- Consumes: `Schema`, `Field`, `Row` (Task 2); `getFieldType`, `FieldType` (Task 2); `createFaker` (Task 2); `hashSeed`, `Rng` (Task 1); `compileFormula`, `evaluateFormula` (Task 4).
- Produces:
  - `class FormulaCycleError extends Error { readonly cycle: string[] }`
  - `formulaOrder(items: { name: string; refs: string[] }[]): string[]`: topological order of the given formula names; refs to non-listed names are ignored; throws `FormulaCycleError`.
  - `interface PlannedField { field: Field; type: FieldType; options: Record<string, unknown>; formula?: CompiledFormula; children?: FieldListPlan }`
  - `interface FieldListPlan { fields: PlannedField[]; formulas: PlannedField[] /* topo order */ }`
  - `planFields(fields: Field[]): FieldListPlan` (assumes validated input; throws on unknown type)
  - `class DataGenerator { constructor(schemas: Schema[]); warnings: number; row(schemaId: string, rowIndex: number, seed: number): Row; rows(schemaId: string, count: number, seed: number): Generator<Row> }`

- [ ] **Step 1: Write the failing test**

`packages/core/test/generator.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema, type SchemaInput } from "../src/model.ts";
import { DataGenerator } from "../src/engine/generator.ts";
import { formulaOrder, FormulaCycleError } from "../src/engine/plan.ts";

const schema = (input: Omit<SchemaInput, "name" | "slug"> & { slug?: string }): Schema =>
  SchemaSchema.parse({ name: input.id, slug: input.slug ?? input.id, ...input });

const customers = schema({
  id: "customers",
  defaultCount: 5,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "first_name", type: "person.firstName" },
    { name: "last_name", type: "person.lastName" },
    { name: "email", type: "formula", options: { expression: 'lower(first_name) + "." + lower(last_name) + "@example.com"' } },
  ],
});

const orders = schema({
  id: "orders",
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "customer_id", type: "reference", options: { schemaId: "customers", fieldName: "id" } },
    { name: "qty", type: "number", options: { min: 1, max: 5 } },
    { name: "price", type: "number", options: { min: 1, max: 100, decimals: 2 } },
    { name: "total", type: "formula", options: { expression: "round(qty * price, 2)", column: "decimal" } },
  ],
});

describe("formulaOrder", () => {
  test("orders dependencies first, keeps declaration order otherwise", () => {
    expect(formulaOrder([{ name: "c", refs: ["b"] }, { name: "a", refs: [] }, { name: "b", refs: ["a", "x"] }])).toEqual([
      "a", "b", "c",
    ]);
  });

  test("detects cycles", () => {
    expect(() => formulaOrder([{ name: "a", refs: ["b"] }, { name: "b", refs: ["a"] }])).toThrow(FormulaCycleError);
    expect(() => formulaOrder([{ name: "a", refs: ["a"] }])).toThrow(FormulaCycleError);
  });
});

describe("DataGenerator", () => {
  test("same seed gives identical rows; different seed differs", () => {
    const a = [...new DataGenerator([customers]).rows("customers", 20, 7)];
    const b = [...new DataGenerator([customers]).rows("customers", 20, 7)];
    const c = [...new DataGenerator([customers]).rows("customers", 20, 8)];
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("row(i) equals row i of the stream", () => {
    const all = [...new DataGenerator([customers]).rows("customers", 10, 3)];
    expect(new DataGenerator([customers]).row("customers", 6, 3)).toEqual(all[6]);
  });

  test("keeps declaration order of keys and evaluates formulas", () => {
    const r = new DataGenerator([customers]).row("customers", 0, 1);
    expect(Object.keys(r)).toEqual(["id", "first_name", "last_name", "email"]);
    expect(r.email).toBe(`${String(r.first_name).toLowerCase()}.${String(r.last_name).toLowerCase()}@example.com`);
  });

  test("formula referencing a later formula is evaluated in dependency order", () => {
    const s = schema({
      id: "f",
      fields: [
        { name: "b", type: "formula", options: { expression: "a + 1" } },
        { name: "a", type: "formula", options: { expression: "n * 2" } },
        { name: "n", type: "number", options: { min: 3, max: 3 } },
      ],
    });
    expect(new DataGenerator([s]).row("f", 0, 1)).toEqual({ b: 7, a: 6, n: 3 });
  });

  test("references point at existing parent rows", () => {
    const gen = new DataGenerator([customers, orders]);
    const ids = new Set([...gen.rows("customers", customers.defaultCount, 1)].map((r) => r.id));
    for (const o of gen.rows("orders", 200, 1)) expect(ids.has(o.customer_id)).toBe(true);
  });

  test("reference resolution does not disturb the parent row's sequence", () => {
    const withRef = new DataGenerator([customers, orders]).row("orders", 3, 1);
    const again = new DataGenerator([customers, orders]).row("orders", 3, 1);
    expect(withRef).toEqual(again);
  });

  test("blankPercent 100 always null, 0 never null, 30 roughly 30%", () => {
    const s = schema({
      id: "b",
      fields: [
        { name: "always", type: "uuid", blankPercent: 100 },
        { name: "never", type: "uuid", blankPercent: 0 },
        { name: "some", type: "uuid", blankPercent: 30 },
        { name: "f", type: "formula", options: { expression: "concat('x', always)" } },
      ],
    });
    let blanks = 0;
    for (const r of new DataGenerator([s]).rows("b", 2000, 1)) {
      expect(r.always).toBeNull();
      expect(r.never).not.toBeNull();
      expect(r.f).toBe("x");
      if (r.some === null) blanks++;
    }
    expect(blanks).toBeGreaterThan(500);
    expect(blanks).toBeLessThan(700);
  });

  test("nested object and array", () => {
    const s = schema({
      id: "n",
      fields: [
        { name: "address", type: "object", children: [{ name: "city", type: "location.city" }, { name: "zip", type: "location.zipCode" }] },
        { name: "tags", type: "array", options: { minItems: 2, maxItems: 2 }, children: [{ name: "tag", type: "word.noun" }] },
        { name: "lines", type: "array", options: { minItems: 1, maxItems: 3 }, children: [{ name: "sku", type: "uuid" }, { name: "qty", type: "number" }] },
        { name: "city_upper", type: "formula", options: { expression: "upper(address.city)" } },
      ],
    });
    const r = new DataGenerator([s]).row("n", 0, 1) as {
      address: { city: string; zip: string };
      tags: unknown[];
      lines: { sku: string; qty: number }[];
      city_upper: string;
    };
    expect(typeof r.address.city).toBe("string");
    expect(r.tags).toHaveLength(2);
    expect(typeof r.tags[0]).toBe("string");
    expect(r.lines.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(r.lines[0]!)).toEqual(["sku", "qty"]);
    expect(r.city_upper).toBe(r.address.city.toUpperCase());
  });

  test("runtime formula errors produce null and count warnings", () => {
    const s = schema({
      id: "w",
      fields: [
        { name: "z", type: "number", options: { min: 0, max: 0 } },
        { name: "bad", type: "formula", options: { expression: "1 / z" } },
      ],
    });
    const gen = new DataGenerator([s]);
    const rows = [...gen.rows("w", 3, 1)];
    expect(rows.every((r) => r.bad === null)).toBe(true);
    expect(gen.warnings).toBe(3);
  });

  test("locale is applied", () => {
    const da = schema({ id: "da", locale: "da", fields: [{ name: "phone", type: "phone.number" }] });
    expect(String(new DataGenerator([da]).row("da", 0, 1).phone)).toMatch(/^\+45/);
  });

  test("unknown schema id throws", () => {
    expect(() => new DataGenerator([customers]).row("nope", 0, 1)).toThrow("Unknown schema");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/core test generator`
Expected: FAIL, cannot resolve `../src/engine/generator.ts`.

- [ ] **Step 3: Implement the plan module**

`packages/core/src/engine/plan.ts`:
```ts
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
```

- [ ] **Step 4: Implement the generator**

`packages/core/src/engine/generator.ts`:
```ts
import type { Faker } from "@faker-js/faker";
import type { Row, Schema } from "../model.ts";
import { Rng, hashSeed } from "../rng.ts";
import { evaluateFormula } from "../formula/evaluate.ts";
import { createFaker } from "./fakers.ts";
import { planFields, type FieldListPlan, type PlannedField } from "./plan.ts";

const REF_CACHE_LIMIT = 10_000;

interface RowState {
  faker: Faker;
  blankRng: Rng;
  rowIndex: number;
  seed: number;
  depth: number;
}

export class DataGenerator {
  warnings = 0;
  readonly #schemas: Map<string, Schema>;
  readonly #plans = new Map<string, FieldListPlan>();
  // One Faker per (locale, depth): resolving a reference re-seeds a faker,
  // so the referencing row must not share its instance.
  readonly #fakers = new Map<string, Faker>();
  readonly #refCache = new Map<string, Row>();

  constructor(schemas: Schema[]) {
    this.#schemas = new Map(schemas.map((s) => [s.id, s]));
  }

  row(schemaId: string, rowIndex: number, seed: number): Row {
    return this.#row(schemaId, rowIndex, seed, 0);
  }

  *rows(schemaId: string, count: number, seed: number): Generator<Row> {
    for (let i = 0; i < count; i++) yield this.row(schemaId, i, seed);
  }

  #schema(id: string): Schema {
    const s = this.#schemas.get(id);
    if (!s) throw new Error(`Unknown schema: ${id}`);
    return s;
  }

  #plan(schema: Schema): FieldListPlan {
    let plan = this.#plans.get(schema.id);
    if (!plan) {
      plan = planFields(schema.fields);
      this.#plans.set(schema.id, plan);
    }
    return plan;
  }

  #faker(locale: string, depth: number): Faker {
    const key = `${locale}#${depth}`;
    let f = this.#fakers.get(key);
    if (!f) {
      f = createFaker(locale);
      this.#fakers.set(key, f);
    }
    return f;
  }

  #row(schemaId: string, rowIndex: number, seed: number, depth: number): Row {
    const schema = this.#schema(schemaId);
    const faker = this.#faker(schema.locale, depth);
    faker.seed(hashSeed(seed, schema.id, rowIndex));
    const blankRng = new Rng(hashSeed(seed, schema.id, rowIndex, "blank"));
    return this.#fields(this.#plan(schema), { faker, blankRng, rowIndex, seed, depth });
  }

  #fields(plan: FieldListPlan, st: RowState): Row {
    const blank = new Set<string>();
    for (const p of plan.fields) if (st.blankRng.chance(p.field.blankPercent)) blank.add(p.field.name);

    const values: Row = {};
    for (const p of plan.fields) {
      if (p.formula) continue;
      values[p.field.name] = blank.has(p.field.name) ? null : this.#value(p, st);
    }
    for (const p of plan.formulas) {
      values[p.field.name] = blank.has(p.field.name) ? null : this.#formula(p, values);
    }

    const out: Row = {};
    for (const p of plan.fields) out[p.field.name] = values[p.field.name];
    return out;
  }

  #value(p: PlannedField, st: RowState): unknown {
    switch (p.type.kind) {
      case "object":
        return this.#fields(p.children!, st);
      case "array": {
        const n = st.faker.number.int({ min: p.options.minItems as number, max: p.options.maxItems as number });
        const single = p.children!.fields.length === 1 ? p.children!.fields[0]!.field.name : undefined;
        return Array.from({ length: n }, () => {
          const item = this.#fields(p.children!, st);
          return single === undefined ? item : item[single];
        });
      }
      case "reference":
        return this.#reference(p.options as { schemaId: string; fieldName: string }, st);
      default:
        return p.type.generate(p.options, { faker: st.faker, rowIndex: st.rowIndex });
    }
  }

  #reference(o: { schemaId: string; fieldName: string }, st: RowState): unknown {
    const target = this.#schema(o.schemaId);
    const index = st.faker.number.int({ min: 0, max: target.defaultCount - 1 });
    const key = `${target.id}:${index}:${st.seed}`;
    let row = this.#refCache.get(key);
    if (!row) {
      row = this.#row(target.id, index, st.seed, st.depth + 1);
      if (this.#refCache.size >= REF_CACHE_LIMIT) this.#refCache.delete(this.#refCache.keys().next().value!);
      this.#refCache.set(key, row);
    }
    return row[o.fieldName] ?? null;
  }

  #formula(p: PlannedField, scope: Row): unknown {
    try {
      const v = evaluateFormula(p.formula!.ast, scope);
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Non-finite result");
      return v;
    } catch {
      this.warnings++;
      return null;
    }
  }
}
```

- [ ] **Step 5: Export from the barrel**

Append to `packages/core/src/index.ts`:
```ts
export { DataGenerator } from "./engine/generator.ts";
export { formulaOrder, FormulaCycleError, planFields } from "./engine/plan.ts";
export type { FieldListPlan, PlannedField } from "./engine/plan.ts";
```

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @mockgen/core test && pnpm --filter @mockgen/core typecheck`
Expected: all tests PASS; exit 0. If the Danish phone test fails because faker's `da` phone format does not start with `+45`, change only that assertion to check the value differs from the `en` locale's value for the same seed (keep the intent: locale is applied).

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): deterministic DataGenerator with formulas, blanks, nesting and references"
```

---

### Task 6: Validation and schema dependency order

**Files:**
- Create: `packages/core/src/order.ts`, `packages/core/src/validate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/validate.test.ts`, `packages/core/test/order.test.ts`

**Interfaces:**
- Consumes: `SchemaSchema`, `Schema`, `Field`, `MAX_NESTING` (Task 2); `getFieldType` (Task 2); `isKnownLocale` (Task 2); `compileFormula`, `FormulaError` (Task 4); `formulaOrder`, `FormulaCycleError` (Task 5).
- Produces:
  - `referencedSchemaIds(schema: Schema): string[]` (direct references, deduplicated)
  - `findReferenceCycle(schemas: Schema[], startId: string): string[] | null` (ids forming a cycle reachable from start, first id repeated at end)
  - `withDependencies(schemas: Schema[], ids: string[]): string[]` (requested ids plus transitive references, parent-first; throws `Error("Unknown schema: <id>")`)
  - `interface ValidationIssue { path: string; message: string }`
  - `formatPath(path: PropertyKey[]): string` (`["fields",3,"options","min"]` → `fields[3].options.min`)
  - `validateSchema(input: unknown, others: Schema[]): { schema?: Schema; issues: ValidationIssue[] }` (`schema` is set only when `issues` is empty; `others` = all saved schemas, the input replaces any with the same id)

- [ ] **Step 1: Write the failing tests**

`packages/core/test/order.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema } from "../src/model.ts";
import { findReferenceCycle, referencedSchemaIds, withDependencies } from "../src/order.ts";

const s = (id: string, refs: string[] = []): Schema =>
  SchemaSchema.parse({
    id,
    name: id,
    slug: id,
    fields: [
      { name: "id", type: "rowNumber" },
      ...refs.map((r, i) => ({
        name: `ref${i}`,
        type: "object",
        children: [{ name: "x", type: "reference", options: { schemaId: r, fieldName: "id" } }],
      })),
    ],
  });

describe("order", () => {
  test("referencedSchemaIds walks nested fields", () => {
    expect(referencedSchemaIds(s("a", ["b", "c", "b"]))).toEqual(["b", "c"]);
  });

  test("withDependencies is parent-first and adds transitive deps", () => {
    const set = [s("orders", ["customers", "products"]), s("customers", ["regions"]), s("products"), s("regions")];
    expect(withDependencies(set, ["orders"])).toEqual(["regions", "customers", "products", "orders"]);
    expect(withDependencies(set, ["products", "customers"])).toEqual(["products", "regions", "customers"]);
  });

  test("withDependencies throws on unknown id", () => {
    expect(() => withDependencies([s("a")], ["b"])).toThrow("Unknown schema: b");
  });

  test("findReferenceCycle", () => {
    const set = [s("a", ["b"]), s("b", ["c"]), s("c", ["a"]), s("d")];
    expect(findReferenceCycle(set, "a")).toEqual(["a", "b", "c", "a"]);
    expect(findReferenceCycle(set, "d")).toBeNull();
  });
});
```

`packages/core/test/validate.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema } from "../src/model.ts";
import { formatPath, validateSchema } from "../src/validate.ts";

const saved: Schema[] = [
  SchemaSchema.parse({ id: "customers", name: "Customers", slug: "customers", fields: [{ name: "id", type: "rowNumber" }] }),
];

const base = { id: "new", name: "New", slug: "orders" };
const paths = (input: unknown, others = saved) => validateSchema(input, others).issues.map((i) => i.path);
const messages = (input: unknown, others = saved) => validateSchema(input, others).issues.map((i) => i.message);

describe("formatPath", () => {
  test("formats arrays with brackets", () => {
    expect(formatPath(["fields", 3, "options", "min"])).toBe("fields[3].options.min");
    expect(formatPath([])).toBe("");
  });
});

describe("validateSchema", () => {
  test("valid schema returns parsed schema", () => {
    const r = validateSchema({ ...base, fields: [{ name: "id", type: "rowNumber" }] }, saved);
    expect(r.issues).toEqual([]);
    expect(r.schema?.locale).toBe("en");
  });

  test("zod issues are mapped to bracket paths", () => {
    expect(paths({ ...base, fields: [{ name: "1x", type: "uuid" }] })).toContain("fields[0].name");
  });

  test("duplicate slug", () => {
    expect(paths({ ...base, slug: "customers", fields: [{ name: "id", type: "uuid" }] })).toEqual(["slug"]);
    // Same id may keep its own slug.
    expect(paths({ ...saved[0], fields: [{ name: "id", type: "uuid" }] })).toEqual([]);
  });

  test("unknown locale", () => {
    expect(paths({ ...base, locale: "xx_YY", fields: [{ name: "id", type: "uuid" }] })).toEqual(["locale"]);
  });

  test("duplicate field names and unknown types", () => {
    expect(
      paths({ ...base, fields: [{ name: "a", type: "uuid" }, { name: "a", type: "uuid" }, { name: "b", type: "nope" }] }),
    ).toEqual(["fields[1].name", "fields[2].type"]);
  });

  test("invalid options are reported under options", () => {
    expect(paths({ ...base, fields: [{ name: "n", type: "number", options: { min: 5, max: 1 } }] })).toEqual([
      "fields[0].options.min",
    ]);
  });

  test("children rules", () => {
    expect(paths({ ...base, fields: [{ name: "o", type: "object" }] })).toEqual(["fields[0].children"]);
    expect(paths({ ...base, fields: [{ name: "u", type: "uuid", children: [{ name: "x", type: "uuid" }] }] })).toEqual([
      "fields[0].children",
    ]);
    expect(
      paths({ ...base, fields: [{ name: "o", type: "object", children: [{ name: "x", type: "nope" }] }] }),
    ).toEqual(["fields[0].children[0].type"]);
  });

  test("nesting deeper than 5 levels", () => {
    let field: Record<string, unknown> = { name: "leaf", type: "uuid" };
    for (let i = 0; i < 6; i++) field = { name: `o${i}`, type: "object", children: [field] };
    expect(messages({ ...base, fields: [field] }).some((m) => m.includes("Nesting deeper than 5"))).toBe(true);
  });

  test("formula syntax, unknown refs and cycles", () => {
    expect(paths({ ...base, fields: [{ name: "f", type: "formula", options: { expression: "1 +" } }] })).toEqual([
      "fields[0].options.expression",
    ]);
    expect(messages({ ...base, fields: [{ name: "f", type: "formula", options: { expression: "nope + 1" } }] })).toEqual([
      'Unknown field "nope"',
    ]);
    const cyc = validateSchema(
      {
        ...base,
        fields: [
          { name: "a", type: "formula", options: { expression: "b" } },
          { name: "b", type: "formula", options: { expression: "a" } },
        ],
      },
      saved,
    ).issues;
    expect(cyc).toHaveLength(1);
    expect(cyc[0]!.path).toBe("fields[0].options.expression");
    expect(cyc[0]!.message).toContain("Circular formula reference");
  });

  test("references must point at an existing schema and top-level field", () => {
    const ref = (schemaId: string, fieldName: string) => ({
      ...base,
      fields: [{ name: "c", type: "reference", options: { schemaId, fieldName } }],
    });
    expect(paths(ref("customers", "id"))).toEqual([]);
    expect(paths(ref("missing", "id"))).toEqual(["fields[0].options.schemaId"]);
    expect(paths(ref("customers", "nope"))).toEqual(["fields[0].options.fieldName"]);
    expect(paths(ref("new", "c"))).toEqual(["fields[0].options.schemaId"]);
  });

  test("cross-schema reference cycles", () => {
    const a = SchemaSchema.parse({
      id: "a",
      name: "A",
      slug: "a",
      fields: [{ name: "id", type: "rowNumber" }, { name: "b", type: "reference", options: { schemaId: "b", fieldName: "id" } }],
    });
    const r = validateSchema(
      { id: "b", name: "B", slug: "b", fields: [{ name: "id", type: "rowNumber" }, { name: "a", type: "reference", options: { schemaId: "a", fieldName: "id" } }] },
      [a],
    );
    expect(r.issues.map((i) => i.path)).toEqual(["fields"]);
    expect(r.issues[0]!.message).toContain("Circular reference between schemas: b → a → b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mockgen/core test validate order`
Expected: FAIL, cannot resolve `../src/validate.ts` / `../src/order.ts`.

- [ ] **Step 3: Implement order.ts**

`packages/core/src/order.ts`:
```ts
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

export function findReferenceCycle(schemas: Schema[], startId: string): string[] | null {
  const byId = new Map(schemas.map((s) => [s.id, s]));
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    const at = path.indexOf(id);
    if (at >= 0) return [...path.slice(at), id];
    const s = byId.get(id);
    if (!s) return null;
    path.push(id);
    for (const dep of referencedSchemaIds(s)) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
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
```

- [ ] **Step 4: Implement validate.ts**

`packages/core/src/validate.ts`:
```ts
import { MAX_NESTING, SchemaSchema, type Field, type Schema } from "./model.ts";
import { getFieldType } from "./types/index.ts";
import { isKnownLocale } from "./engine/fakers.ts";
import { compileFormula, FormulaError } from "./formula/compile.ts";
import { formulaOrder, FormulaCycleError } from "./engine/plan.ts";
import { findReferenceCycle } from "./order.ts";

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

export function validateSchema(input: unknown, others: Schema[]): { schema?: Schema; issues: ValidationIssue[] } {
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
    if (seen.has(field.name)) ctx.issues.push({ path: `${at}.name`, message: "Duplicate field name" });
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
        if (!unknown.length) formulas.push({ name: field.name, refs, index: i });
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
```

- [ ] **Step 5: Export from the barrel**

Append to `packages/core/src/index.ts`:
```ts
export { formatPath, validateSchema } from "./validate.ts";
export type { ValidationIssue } from "./validate.ts";
export { findReferenceCycle, referencedSchemaIds, withDependencies } from "./order.ts";
```

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @mockgen/core test && pnpm --filter @mockgen/core typecheck`
Expected: all PASS; exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): schema validation and reference dependency ordering"
```

---

### Task 7: Output formats (flatten, CSV, JSON, NDJSON, SQL)

**Files:**
- Create: `packages/core/src/formats/flatten.ts`, `packages/core/src/formats/csv.ts`, `packages/core/src/formats/json.ts`, `packages/core/src/formats/sql.ts`, `packages/core/src/formats/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/formats.test.ts`

**Interfaces:**
- Consumes: `Schema`, `Field`, `Row` (Task 2); `ColumnType`, `Dialect`, `columnSql` (Task 2); `getFieldType` (Task 2); `DataGenerator` (Task 5, tests only).
- Produces:
  - `interface Column { name: string; type: ColumnType; path: string[] }`
  - `flattenColumns(fields: Field[], schemas: Schema[]): Column[]`
  - `flattenRow(row: Row, columns: Column[]): unknown[]`
  - `toCsv(columns: Column[], rows: Iterable<Row>): Generator<string>`; `csvCell(v: unknown): string`
  - `toJsonArray(rows: Iterable<Row>): Generator<string>`; `toNdjson(rows: Iterable<Row>): Generator<string>`
  - `quoteIdent(name: string, dialect: Dialect): string`; `sqlLiteral(v: unknown, column: Column, dialect: Dialect): string`; `createTableSql(table: string, columns: Column[], dialect: Dialect): string`; `insertStatements(table: string, columns: Column[], rows: Iterable<Row>, dialect: Dialect, batchSize?: number): Generator<string>` (default batch 500, max 1000); `deleteRowsSql(table: string, dialect: Dialect): string`
  - `type Format = "csv" | "json" | "ndjson" | "sql"`; `FORMATS: readonly Format[]`; `FORMAT_MIME: Record<Format, string>`; `formatRows(format: Format, schema: Schema, schemas: Schema[], rows: Iterable<Row>, opts?: { dialect?: Dialect; ddl?: boolean }): Iterable<string>`

- [ ] **Step 1: Write the failing test**

`packages/core/test/formats.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema } from "../src/model.ts";
import { flattenColumns, flattenRow } from "../src/formats/flatten.ts";
import { csvCell, toCsv } from "../src/formats/csv.ts";
import { toJsonArray, toNdjson } from "../src/formats/json.ts";
import { createTableSql, deleteRowsSql, insertStatements, quoteIdent, sqlLiteral } from "../src/formats/sql.ts";
import { formatRows } from "../src/formats/index.ts";

const customers = SchemaSchema.parse({
  id: "c",
  name: "C",
  slug: "customers",
  fields: [{ name: "id", type: "uuid" }],
});

const people = SchemaSchema.parse({
  id: "p",
  name: "P",
  slug: "people",
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "name", type: "person.firstName" },
    { name: "active", type: "boolean" },
    { name: "born", type: "date.birthdate" },
    { name: "customer_id", type: "reference", options: { schemaId: "c", fieldName: "id" } },
    { name: "address", type: "object", children: [{ name: "city", type: "location.city" }] },
    { name: "tags", type: "array", children: [{ name: "t", type: "word.noun" }] },
  ],
});

const schemas: Schema[] = [customers, people];
const row = {
  id: 1,
  name: "O'Brien, \"Al\"",
  active: true,
  born: "1990-05-01",
  customer_id: "6f1c0000-0000-4000-8000-000000000000",
  address: { city: "Aarhus" },
  tags: ["a", "b"],
};

describe("flatten", () => {
  test("columns flatten objects, keep arrays as json and resolve reference types", () => {
    expect(flattenColumns(people.fields, schemas).map((c) => [c.name, c.type])).toEqual([
      ["id", "bigint"],
      ["name", "text"],
      ["active", "bool"],
      ["born", "date"],
      ["customer_id", "uuid"],
      ["address_city", "text"],
      ["tags", "json"],
    ]);
  });

  test("row values follow columns", () => {
    const cols = flattenColumns(people.fields, schemas);
    expect(flattenRow(row, cols)).toEqual([
      1, "O'Brien, \"Al\"", true, "1990-05-01", "6f1c0000-0000-4000-8000-000000000000", "Aarhus", '["a","b"]',
    ]);
    expect(flattenRow({ ...row, address: null }, cols)[5]).toBeNull();
  });
});

describe("csv", () => {
  test("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(false)).toBe("false");
  });

  test("header + rows with CRLF", () => {
    const cols = flattenColumns(people.fields, schemas);
    const out = [...toCsv(cols, [row])].join("");
    expect(out).toBe(
      'id,name,active,born,customer_id,address_city,tags\r\n' +
        '1,"O\'Brien, ""Al""",true,1990-05-01,6f1c0000-0000-4000-8000-000000000000,Aarhus,"[""a"",""b""]"\r\n',
    );
  });
});

describe("json", () => {
  test("array output parses back", () => {
    expect(JSON.parse([...toJsonArray([row, row])].join(""))).toEqual([row, row]);
    expect(JSON.parse([...toJsonArray([])].join(""))).toEqual([]);
  });

  test("ndjson one object per line", () => {
    const lines = [...toNdjson([row, row])].join("").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(row);
  });
});

describe("sql", () => {
  const cols = flattenColumns(people.fields, schemas);

  test("identifiers", () => {
    expect(quoteIdent("a-b", "pg")).toBe('"a-b"');
    expect(quoteIdent("x]y", "mssql")).toBe("[x]]y]");
  });

  test("literals per dialect", () => {
    const text = cols[1]!;
    const bool = cols[2]!;
    expect(sqlLiteral("O'Brien", text, "pg")).toBe("'O''Brien'");
    expect(sqlLiteral("O'Brien", text, "mssql")).toBe("N'O''Brien'");
    expect(sqlLiteral(true, bool, "pg")).toBe("TRUE");
    expect(sqlLiteral(true, bool, "mssql")).toBe("1");
    expect(sqlLiteral(null, text, "sqlite")).toBe("NULL");
    expect(sqlLiteral(1.5, text, "pg")).toBe("1.5");
    const dt = { name: "d", type: "datetime" as const, path: ["d"] };
    expect(sqlLiteral("2024-01-01T10:00:00.000Z", dt, "mssql")).toBe("N'2024-01-01T10:00:00.000'");
    expect(sqlLiteral("2024-01-01T10:00:00.000Z", dt, "pg")).toBe("'2024-01-01T10:00:00.000Z'");
  });

  test("create table per dialect", () => {
    expect(createTableSql("people", cols.slice(0, 2), "pg")).toBe(
      'CREATE TABLE IF NOT EXISTS "people" (\n  "id" bigint,\n  "name" text\n);\n',
    );
    expect(createTableSql("people", cols.slice(0, 2), "mssql")).toBe(
      "IF OBJECT_ID(N'people', N'U') IS NULL\nCREATE TABLE [people] (\n  [id] bigint,\n  [name] nvarchar(max)\n);\n",
    );
    expect(deleteRowsSql("people", "mssql")).toBe("DELETE FROM [people];\n");
  });

  test("inserts are batched", () => {
    const two = cols.slice(0, 1);
    const stmts = [...insertStatements("t", two, [{ id: 1 }, { id: 2 }, { id: 3 }], "pg", 2)];
    expect(stmts).toEqual(['INSERT INTO "t" ("id") VALUES\n(1),\n(2);\n', 'INSERT INTO "t" ("id") VALUES\n(3);\n']);
  });

  test("batch size is capped at 1000", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    expect([...insertStatements("t", cols.slice(0, 1), rows, "mssql", 5000)]).toHaveLength(2);
  });
});

describe("formatRows", () => {
  test("sql with ddl uses slug as table", () => {
    const out = [...formatRows("sql", customers, schemas, [{ id: "x" }], { dialect: "sqlite", ddl: true })].join("");
    expect(out).toBe('CREATE TABLE IF NOT EXISTS "customers" (\n  "id" TEXT\n);\n\nINSERT INTO "customers" ("id") VALUES\n(\'x\');\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/core test formats`
Expected: FAIL, cannot resolve `../src/formats/flatten.ts`.

- [ ] **Step 3: Implement flatten**

`packages/core/src/formats/flatten.ts`:
```ts
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
```

- [ ] **Step 4: Implement CSV and JSON**

`packages/core/src/formats/csv.ts`:
```ts
import type { Row } from "../model.ts";
import { flattenRow, type Column } from "./flatten.ts";

export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function* toCsv(columns: Column[], rows: Iterable<Row>): Generator<string> {
  yield columns.map((c) => csvCell(c.name)).join(",") + "\r\n";
  for (const row of rows) yield flattenRow(row, columns).map(csvCell).join(",") + "\r\n";
}
```

`packages/core/src/formats/json.ts`:
```ts
import type { Row } from "../model.ts";

export function* toJsonArray(rows: Iterable<Row>): Generator<string> {
  let first = true;
  yield "[";
  for (const row of rows) {
    yield (first ? "\n" : ",\n") + JSON.stringify(row);
    first = false;
  }
  yield first ? "]\n" : "\n]\n";
}

export function* toNdjson(rows: Iterable<Row>): Generator<string> {
  for (const row of rows) yield JSON.stringify(row) + "\n";
}
```

- [ ] **Step 5: Implement SQL**

`packages/core/src/formats/sql.ts`:
```ts
import { columnSql, type Dialect } from "../columns.ts";
import type { Row } from "../model.ts";
import { flattenRow, type Column } from "./flatten.ts";

export const MAX_BATCH = 1000;

export function quoteIdent(name: string, dialect: Dialect): string {
  return dialect === "mssql" ? `[${name.replace(/]/g, "]]")}]` : `"${name.replace(/"/g, '""')}"`;
}

export function sqlLiteral(v: unknown, column: Column, dialect: Dialect): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return dialect === "pg" ? (v ? "TRUE" : "FALSE") : v ? "1" : "0";
  let s = String(v);
  // datetime2 does not accept a trailing Z.
  if (dialect === "mssql" && column.type === "datetime" && s.endsWith("Z")) s = s.slice(0, -1);
  const escaped = s.replace(/'/g, "''");
  return dialect === "mssql" ? `N'${escaped}'` : `'${escaped}'`;
}

export function createTableSql(table: string, columns: Column[], dialect: Dialect): string {
  const cols = columns.map((c) => `  ${quoteIdent(c.name, dialect)} ${columnSql(c.type, dialect)}`).join(",\n");
  const t = quoteIdent(table, dialect);
  if (dialect === "mssql") {
    return `IF OBJECT_ID(N'${table.replace(/'/g, "''")}', N'U') IS NULL\nCREATE TABLE ${t} (\n${cols}\n);\n`;
  }
  return `CREATE TABLE IF NOT EXISTS ${t} (\n${cols}\n);\n`;
}

export function deleteRowsSql(table: string, dialect: Dialect): string {
  return `DELETE FROM ${quoteIdent(table, dialect)};\n`;
}

export function* insertStatements(
  table: string,
  columns: Column[],
  rows: Iterable<Row>,
  dialect: Dialect,
  batchSize = 500,
): Generator<string> {
  const size = Math.max(1, Math.min(batchSize, MAX_BATCH));
  const head = `INSERT INTO ${quoteIdent(table, dialect)} (${columns.map((c) => quoteIdent(c.name, dialect)).join(", ")}) VALUES\n`;
  let batch: string[] = [];
  for (const row of rows) {
    const values = flattenRow(row, columns).map((v, i) => sqlLiteral(v, columns[i]!, dialect));
    batch.push(`(${values.join(", ")})`);
    if (batch.length === size) {
      yield head + batch.join(",\n") + ";\n";
      batch = [];
    }
  }
  if (batch.length) yield head + batch.join(",\n") + ";\n";
}
```

- [ ] **Step 6: Implement the formats index**

`packages/core/src/formats/index.ts`:
```ts
import type { Dialect } from "../columns.ts";
import type { Row, Schema } from "../model.ts";
import { toCsv } from "./csv.ts";
import { flattenColumns } from "./flatten.ts";
import { toJsonArray, toNdjson } from "./json.ts";
import { createTableSql, insertStatements } from "./sql.ts";

export type Format = "csv" | "json" | "ndjson" | "sql";
export const FORMATS: readonly Format[] = ["csv", "json", "ndjson", "sql"];
export const FORMAT_MIME: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  sql: "application/sql; charset=utf-8",
};

export interface FormatOptions {
  dialect?: Dialect;
  ddl?: boolean;
}

export function* formatRows(
  format: Format,
  schema: Schema,
  schemas: Schema[],
  rows: Iterable<Row>,
  opts: FormatOptions = {},
): Generator<string> {
  switch (format) {
    case "json":
      return yield* toJsonArray(rows);
    case "ndjson":
      return yield* toNdjson(rows);
    case "csv":
      return yield* toCsv(flattenColumns(schema.fields, schemas), rows);
    case "sql": {
      const dialect = opts.dialect ?? "pg";
      const columns = flattenColumns(schema.fields, schemas);
      if (opts.ddl) yield createTableSql(schema.slug, columns, dialect) + "\n";
      return yield* insertStatements(schema.slug, columns, rows, dialect);
    }
  }
}
```

- [ ] **Step 7: Export from the barrel**

Append to `packages/core/src/index.ts`:
```ts
export { flattenColumns, flattenRow } from "./formats/flatten.ts";
export type { Column } from "./formats/flatten.ts";
export { csvCell, toCsv } from "./formats/csv.ts";
export { toJsonArray, toNdjson } from "./formats/json.ts";
export { createTableSql, deleteRowsSql, insertStatements, quoteIdent, sqlLiteral, MAX_BATCH } from "./formats/sql.ts";
export { FORMATS, FORMAT_MIME, formatRows } from "./formats/index.ts";
export type { Format, FormatOptions } from "./formats/index.ts";
```

- [ ] **Step 8: Add an end-to-end core test**

Append to `packages/core/test/formats.test.ts`:
```ts
import { DataGenerator } from "../src/engine/generator.ts";

describe("end to end", () => {
  test("generated rows format to every format deterministically", () => {
    const run = (format: "csv" | "json" | "ndjson" | "sql") => {
      const gen = new DataGenerator(schemas);
      return [...formatRows(format, people, schemas, gen.rows("p", 25, 11), { dialect: "mssql", ddl: true })].join("");
    };
    for (const f of ["csv", "json", "ndjson", "sql"] as const) {
      expect(run(f)).toBe(run(f));
      expect(run(f).length).toBeGreaterThan(100);
    }
    expect(JSON.parse(run("json"))).toHaveLength(25);
  });
});
```

- [ ] **Step 9: Run all core tests and type check**

Run: `pnpm --filter @mockgen/core test && pnpm --filter @mockgen/core typecheck`
Expected: all PASS; exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/core
git commit -m "feat(core): CSV, JSON, NDJSON and SQL output formats"
```
