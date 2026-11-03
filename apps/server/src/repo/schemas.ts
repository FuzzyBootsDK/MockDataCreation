import type { Schema } from "@mockgen/core";
import type { Db } from "../db.ts";

export class SchemaRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  all(): Schema[] {
    const rows = this.#db.prepare("SELECT json FROM schemas ORDER BY name COLLATE NOCASE, id").all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Schema);
  }

  get(id: string): Schema | undefined {
    const row = this.#db.prepare("SELECT json FROM schemas WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Schema) : undefined;
  }

  getBySlug(slug: string): Schema | undefined {
    const row = this.#db.prepare("SELECT json FROM schemas WHERE slug = ?").get(slug) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Schema) : undefined;
  }

  save(schema: Schema): void {
    this.#db
      .prepare(
        `INSERT INTO schemas (id, slug, name, json, updated_at) VALUES (@id, @slug, @name, @json, @now)
         ON CONFLICT(id) DO UPDATE SET slug = @slug, name = @name, json = @json, updated_at = @now`,
      )
      .run({ id: schema.id, slug: schema.slug, name: schema.name, json: JSON.stringify(schema), now: new Date().toISOString() });
  }

  delete(id: string): boolean {
    return this.#db.prepare("DELETE FROM schemas WHERE id = ?").run(id).changes > 0;
  }
}
