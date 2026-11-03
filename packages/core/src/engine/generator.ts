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
