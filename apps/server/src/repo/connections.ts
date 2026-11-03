import type { Connection } from "../connections/model.ts";
import type { Db } from "../db.ts";

export class ConnectionRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  all(): Connection[] {
    const rows = this.#db.prepare("SELECT json FROM connections ORDER BY name COLLATE NOCASE, id").all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Connection);
  }

  get(id: string): Connection | undefined {
    const row = this.#db.prepare("SELECT json FROM connections WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Connection) : undefined;
  }

  save(c: Connection): void {
    this.#db
      .prepare(
        `INSERT INTO connections (id, name, json, updated_at) VALUES (@id, @name, @json, @now)
         ON CONFLICT(id) DO UPDATE SET name = @name, json = @json, updated_at = @now`,
      )
      .run({ id: c.id, name: c.name, json: JSON.stringify(c), now: new Date().toISOString() });
  }

  delete(id: string): boolean {
    return this.#db.prepare("DELETE FROM connections WHERE id = ?").run(id).changes > 0;
  }
}
