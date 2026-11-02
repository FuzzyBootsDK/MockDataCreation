# mockgen Part 3: Database Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user save connection profiles (PostgreSQL, SQL Server, SQLite) and seed generated rows directly into those databases, with live progress over Server-Sent Events.

**Architecture:** New server modules under `apps/server/src/connections` and `apps/server/src/seed`. A `SeedTarget` interface hides the three drivers behind `exec/begin/commit/rollback/close`. `runSeed` reuses core's `createTableSql`, `deleteRowsSql` and `insertStatements` (batched multi-row INSERT for all three dialects), and `resolveExport` from Part 2 for dependency order, counts and the shared seed. Jobs run in the background; `SeedJobs` keeps their events in memory for SSE replay.

**Tech Stack:** pg 8.23.1, mssql 12.7.13, better-sqlite3 13.0.3, Testcontainers 12.2.1 (`@testcontainers/postgresql`, `@testcontainers/mssqlserver`) for integration tests.

**Spec:** `docs/superpowers/specs/2026-11-02-mockgen-design.md` (§5.4)

**Plan series:** Part 1 Core → Part 2 Server → **Part 3 Seeding (this)** → Part 4 Web UI & Docker. Requires Parts 1–2 complete.

## Global Constraints

- Same TypeScript rules as Parts 1–2 (erasable syntax only, `.ts` import extensions).
- Connection passwords are stored in plaintext in the local SQLite database (single-user local tool). A password of the exact form `${ENV_VAR}` is resolved from the server's environment at connect time; a missing variable is a 400 `Environment variable ENV_VAR is not set`.
- SQLite connection `file` is resolved relative to `DATA_DIR`. Seeding into mockgen's own `mockgen.db` is refused (400).
- Modes: `create` (`CREATE TABLE IF NOT EXISTS` then insert), `append` (insert only), `truncate` (`DELETE FROM` all target tables child-first in one transaction, then insert).
- Inserts: batches of 500 rows; one transaction per schema. On failure: roll back the current schema's transaction; earlier schemas stay committed; final events report `table`, `batch` (1-based) and the driver message.
- Seed requests use `resolveExport` (Part 2): referenced schemas are added automatically and must use their `defaultCount`; counts ≤ `MAX_ROWS`.
- Integration tests against real Postgres/SQL Server run only when `SEED_IT=1` (they need Docker and pull large images).

## File Structure

```
apps/server/src/connections/model.ts    ConnectionSchema, Connection, resolveSecret
apps/server/src/repo/connections.ts     ConnectionRepo
apps/server/src/seed/targets.ts         SeedTarget + openTarget (pg, mssql, sqlite)
apps/server/src/seed/runner.ts          runSeed, SeedEvent, SeedMode
apps/server/src/seed/jobs.ts            SeedJobs (in-memory job/event store)
apps/server/src/routes/connections.ts   /api/connections CRUD + test
apps/server/src/routes/seed.ts          POST /api/seed, GET /api/seed/:id, GET /api/seed/:id/events
apps/server/src/app.ts                  (modify) add repos/jobs to AppContext, register routes
apps/server/test/connections.test.ts
apps/server/test/seed.test.ts
apps/server/test/seed.integration.test.ts
```

---

### Task 1: Connection profiles and database targets

**Files:**
- Create: `apps/server/src/connections/model.ts`, `apps/server/src/repo/connections.ts`, `apps/server/src/seed/targets.ts`, `apps/server/src/routes/connections.ts`
- Modify: `apps/server/package.json` (dependencies), `apps/server/src/app.ts`
- Test: `apps/server/test/connections.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `HttpError`, `ValidationFailed`, `Db` (Part 2); from core: `formatPath`, `Dialect`.
- Produces:
  - `ConnectionSchema` (Zod discriminated union on `kind`); `type Connection = PgConnection | MssqlConnection | SqliteConnection` with fields — pg: `{ id, name, kind: "pg", host, port=5432, database, user, password="", ssl=false }`; mssql: `{ id, name, kind: "mssql", host, port=1433, database, user, password="", encrypt=true, trustServerCertificate=true }`; sqlite: `{ id, name, kind: "sqlite", file }`
  - `resolveSecret(value: string, env: NodeJS.ProcessEnv): string`
  - `class ConnectionRepo { all(): Connection[]; get(id): Connection | undefined; save(c: Connection): void; delete(id): boolean }`
  - `interface SeedTarget { dialect: Dialect; exec(sql: string): Promise<void>; begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; close(): Promise<void> }`
  - `openTarget(conn: Connection, opts: { dataDir: string; env: NodeJS.ProcessEnv }): Promise<SeedTarget>`
  - `AppContext` gains `connections: ConnectionRepo`
  - Routes: `GET /api/connections`, `POST /api/connections` (201), `PUT /api/connections/:id`, `DELETE /api/connections/:id` (204), `POST /api/connections/:id/test` → `{ ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Add dependencies**

In `apps/server/package.json` add to `dependencies`:
```json
    "mssql": "12.7.13",
    "pg": "8.23.1",
```
and to `devDependencies`:
```json
    "@testcontainers/mssqlserver": "12.2.1",
    "@testcontainers/postgresql": "12.2.1",
    "@types/mssql": "12.3.0",
    "@types/pg": "8.23.1",
```

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 2: Write the failing test**

`apps/server/test/connections.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveSecret } from "../src/connections/model.ts";
import { makeApp } from "./helpers.ts";

const sqliteConn = { name: "Local", kind: "sqlite", file: "seed-test.db" };

describe("resolveSecret", () => {
  test("plain values pass through, ${VAR} resolves, missing var throws", () => {
    expect(resolveSecret("secret", {})).toBe("secret");
    expect(resolveSecret("${PG_PW}", { PG_PW: "x" })).toBe("x");
    expect(resolveSecret("pre${PG_PW}", { PG_PW: "x" })).toBe("pre${PG_PW}");
    expect(() => resolveSecret("${NOPE}", {})).toThrow("Environment variable NOPE is not set");
  });
});

describe("/api/connections", () => {
  test("CRUD with defaults per kind", async () => {
    const app = await makeApp();
    const pg = await app.inject({
      method: "POST",
      url: "/api/connections",
      payload: { name: "PG", kind: "pg", host: "localhost", database: "db", user: "u" },
    });
    expect(pg.statusCode).toBe(201);
    expect(pg.json()).toMatchObject({ kind: "pg", port: 5432, password: "", ssl: false });
    const id = pg.json().id as string;

    const upd = await app.inject({ method: "PUT", url: `/api/connections/${id}`, payload: { ...pg.json(), name: "Renamed" } });
    expect(upd.json()).toMatchObject({ id, name: "Renamed" });

    expect((await app.inject({ method: "GET", url: "/api/connections" })).json()).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/connections/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/connections/${id}` })).statusCode).toBe(404);
  });

  test("validation errors", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "POST", url: "/api/connections", payload: { name: "X", kind: "pg", host: "" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["host", "database", "user"]));
    const bad = await app.inject({ method: "POST", url: "/api/connections", payload: { name: "X", kind: "oracle" } });
    expect(bad.statusCode).toBe(400);
  });

  test("test endpoint succeeds for sqlite and reports failures", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-conn-"));
    const app = await makeApp({ dataDir });
    const ok = await app.inject({ method: "POST", url: "/api/connections", payload: sqliteConn });
    const t = await app.inject({ method: "POST", url: `/api/connections/${ok.json().id}/test` });
    expect(t.json()).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dataDir, "seed-test.db"))).toBe(true);

    const pg = await app.inject({
      method: "POST",
      url: "/api/connections",
      payload: { name: "Down", kind: "pg", host: "127.0.0.1", port: 1, database: "x", user: "x" },
    });
    const fail = await app.inject({ method: "POST", url: `/api/connections/${pg.json().id}/test` });
    expect(fail.json().ok).toBe(false);
    expect(fail.json().error).toEqual(expect.any(String));
  });

  test("refuses mockgen's own database", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-conn-"));
    const app = await makeApp({ dataDir });
    const c = await app.inject({ method: "POST", url: "/api/connections", payload: { ...sqliteConn, file: "mockgen.db" } });
    const t = await app.inject({ method: "POST", url: `/api/connections/${c.json().id}/test` });
    expect(t.json()).toEqual({ ok: false, error: "Cannot seed into mockgen's own database" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mockgen/server test connections`
Expected: FAIL, cannot resolve `../src/connections/model.ts`.

- [ ] **Step 4: Implement the model and repo**

`apps/server/src/connections/model.ts`:
```ts
import { z } from "zod";
import { HttpError } from "../errors.ts";

const base = { id: z.string().min(1), name: z.string().min(1).max(200) };
const server = {
  host: z.string().min(1, "Enter a host"),
  database: z.string().min(1, "Enter a database"),
  user: z.string().min(1, "Enter a user"),
  password: z.string().default(""),
};

export const ConnectionSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, ...server, kind: z.literal("pg"), port: z.number().int().min(1).max(65535).default(5432), ssl: z.boolean().default(false) }),
  z.object({
    ...base,
    ...server,
    kind: z.literal("mssql"),
    port: z.number().int().min(1).max(65535).default(1433),
    encrypt: z.boolean().default(true),
    trustServerCertificate: z.boolean().default(true),
  }),
  z.object({ ...base, kind: z.literal("sqlite"), file: z.string().min(1, "Enter a file path") }),
]);

export type Connection = z.infer<typeof ConnectionSchema>;

const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function resolveSecret(value: string, env: NodeJS.ProcessEnv): string {
  const m = ENV_REF.exec(value);
  if (!m) return value;
  const v = env[m[1]!];
  if (v === undefined) throw new HttpError(400, `Environment variable ${m[1]} is not set`);
  return v;
}
```

`apps/server/src/repo/connections.ts`:
```ts
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
```

- [ ] **Step 5: Implement the targets**

`apps/server/src/seed/targets.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sql from "mssql";
import pg from "pg";
import type { Dialect } from "@mockgen/core";
import { resolveSecret, type Connection } from "../connections/model.ts";
import { HttpError } from "../errors.ts";

export interface SeedTarget {
  dialect: Dialect;
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

export async function openTarget(
  conn: Connection,
  opts: { dataDir: string; env: NodeJS.ProcessEnv },
): Promise<SeedTarget> {
  switch (conn.kind) {
    case "sqlite":
      return openSqlite(conn.file, opts.dataDir);
    case "pg":
      return openPg(conn, resolveSecret(conn.password, opts.env));
    case "mssql":
      return openMssql(conn, resolveSecret(conn.password, opts.env));
  }
}

function openSqlite(file: string, dataDir: string): SeedTarget {
  const resolved = path.resolve(dataDir, file);
  if (resolved === path.resolve(dataDir, "mockgen.db")) throw new HttpError(400, "Cannot seed into mockgen's own database");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  return {
    dialect: "sqlite",
    exec: async (text) => void db.exec(text),
    begin: async () => void db.exec("BEGIN"),
    commit: async () => void db.exec("COMMIT"),
    rollback: async () => void db.exec("ROLLBACK"),
    close: async () => void db.close(),
  };
}

async function openPg(conn: Extract<Connection, { kind: "pg" }>, password: string): Promise<SeedTarget> {
  const client = new pg.Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password,
    ssl: conn.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return {
    dialect: "pg",
    exec: async (text) => void (await client.query(text)),
    begin: async () => void (await client.query("BEGIN")),
    commit: async () => void (await client.query("COMMIT")),
    rollback: async () => void (await client.query("ROLLBACK")),
    close: () => client.end(),
  };
}

async function openMssql(conn: Extract<Connection, { kind: "mssql" }>, password: string): Promise<SeedTarget> {
  const pool = await new sql.ConnectionPool({
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password,
    connectionTimeout: 10_000,
    requestTimeout: 120_000,
    options: { encrypt: conn.encrypt, trustServerCertificate: conn.trustServerCertificate },
  }).connect();
  let tx: sql.Transaction | null = null;
  return {
    dialect: "mssql",
    exec: async (text) => void (await (tx ? new sql.Request(tx) : pool.request()).batch(text)),
    begin: async () => {
      tx = new sql.Transaction(pool);
      await tx.begin();
    },
    commit: async () => {
      await tx?.commit();
      tx = null;
    },
    rollback: async () => {
      const t = tx;
      tx = null;
      await t?.rollback();
    },
    close: () => pool.close(),
  };
}
```

- [ ] **Step 6: Implement the routes and wire them in**

`apps/server/src/routes/connections.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { formatPath } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { ConnectionSchema, type Connection } from "../connections/model.ts";
import { HttpError, ValidationFailed } from "../errors.ts";
import { openTarget } from "../seed/targets.ts";

function parse(body: unknown, id: string): Connection {
  const input = { ...(typeof body === "object" && body !== null ? body : {}), id };
  const r = ConnectionSchema.safeParse(input);
  if (!r.success) throw new ValidationFailed(r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })));
  return r.data;
}

export function requireConnection(ctx: AppContext, id: string): Connection {
  const c = ctx.connections.get(id);
  if (!c) throw new HttpError(404, `Connection ${id} not found`);
  return c;
}

export function connectionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/connections", async () => ctx.connections.all());

  app.post("/api/connections", async (req, reply) => {
    const c = parse(req.body, randomUUID());
    ctx.connections.save(c);
    return reply.status(201).send(c);
  });

  app.put<{ Params: { id: string } }>("/api/connections/:id", async (req) => {
    requireConnection(ctx, req.params.id);
    const c = parse(req.body, req.params.id);
    ctx.connections.save(c);
    return c;
  });

  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (req, reply) => {
    if (!ctx.connections.delete(req.params.id)) throw new HttpError(404, `Connection ${req.params.id} not found`);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (req) => {
    const conn = requireConnection(ctx, req.params.id);
    try {
      const target = await openTarget(conn, { dataDir: ctx.config.dataDir, env: process.env });
      try {
        await target.exec("SELECT 1");
      } finally {
        await target.close();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
```

In `apps/server/src/app.ts`:
- add imports `import { ConnectionRepo } from "./repo/connections.ts";` and `import { connectionRoutes } from "./routes/connections.ts";`
- add `connections: ConnectionRepo;` to `AppContext` and `connections: new ConnectionRepo(opts.db)` to the `ctx` object
- register `connectionRoutes(app, ctx);` after `mockRoutes(app, ctx);` (before `await webRoutes(app, ctx);`)

- [ ] **Step 7: Run tests and type check**

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): connection profiles and Postgres/SQL Server/SQLite seed targets"
```

---

### Task 2: Seed runner, job store and seed API with SSE progress

**Files:**
- Create: `apps/server/src/seed/runner.ts`, `apps/server/src/seed/jobs.ts`, `apps/server/src/routes/seed.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/seed.test.ts`

**Interfaces:**
- Consumes: `SeedTarget`, `openTarget`, `requireConnection` (Task 1); `resolveExport`, `ExportItem` (Part 2 Task 3); from core: `DataGenerator`, `flattenColumns`, `createTableSql`, `deleteRowsSql`, `insertStatements`, `Schema`.
- Produces:
  - `type SeedMode = "create" | "append" | "truncate"`; `SEED_MODES`; `SEED_BATCH = 500`
  - `type SeedEvent = { type: "start"; tables: { table: string; total: number }[] } | { type: "progress"; table: string; inserted: number; total: number } | { type: "table-done"; table: string; inserted: number } | { type: "error"; table: string; batch: number; message: string } | { type: "done"; ok: boolean; warnings: number }`
  - `runSeed(target: SeedTarget, plan: { all: Schema[]; items: ExportItem[]; seed: number; mode: SeedMode }, emit: (e: SeedEvent) => void): Promise<boolean>`
  - `class SeedJobs { create(): SeedJob; get(id: string): SeedJob | undefined; emit(job: SeedJob, e: SeedEvent): void; subscribe(job: SeedJob, fn: (e: SeedEvent) => void): () => void }`, `interface SeedJob { id: string; events: SeedEvent[]; done: boolean }`
  - `AppContext` gains `seedJobs: SeedJobs`
  - Routes: `POST /api/seed` body `{ connectionId: string; schemas: { id: string; count?: number }[]; mode: SeedMode; seed?: number }` → 202 `{ jobId }`; `GET /api/seed/:jobId` → `{ id, done, events }`; `GET /api/seed/:jobId/events` → `text/event-stream`, one `data: <SeedEvent JSON>\n\n` per event, ends after `done`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/seed.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { describe, expect, test } from "vitest";
import { createSchema, customersInput, makeApp, ordersInput } from "./helpers.ts";

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-seed-"));
  const app = await makeApp({ dataDir });
  const c = await createSchema(app, customersInput);
  const o = await createSchema(app, ordersInput(c.id));
  const conn = (await app.inject({ method: "POST", url: "/api/connections", payload: { name: "L", kind: "sqlite", file: "target.db" } })).json();
  const file = path.join(dataDir, "target.db");
  return { app, c, o, conn, file };
}

async function seed(app: FastifyInstance, body: object) {
  const r = await app.inject({ method: "POST", url: "/api/seed", payload: body });
  expect(r.statusCode, r.body).toBe(202);
  const jobId = r.json().jobId as string;
  for (let i = 0; i < 200; i++) {
    const job = (await app.inject({ method: "GET", url: `/api/seed/${jobId}` })).json();
    if (job.done) return { jobId, events: job.events as { type: string; [k: string]: unknown }[] };
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("seed job did not finish");
}

const count = (file: string, table: string) =>
  (new Database(file).prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

describe("seeding into SQLite", () => {
  test("create mode creates tables parent-first and inserts rows", async () => {
    const { app, o, conn, file } = await setup();
    const { events } = await seed(app, { connectionId: conn.id, schemas: [{ id: o.id, count: 1200 }], mode: "create" });
    expect(events[0]).toEqual({ type: "start", tables: [{ table: "customers", total: 5 }, { table: "orders", total: 1200 }] });
    expect(events.at(-1)).toEqual({ type: "done", ok: true, warnings: 0 });
    const progress = events.filter((e) => e.type === "progress" && e.table === "orders").map((e) => e.inserted);
    expect(progress).toEqual([500, 1000, 1200]);
    expect(count(file, "customers")).toBe(5);
    expect(count(file, "orders")).toBe(1200);
    const db = new Database(file);
    const orphans = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE customer_id NOT IN (SELECT id FROM customers)`).get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  test("append adds rows, truncate replaces them", async () => {
    const { app, c, conn, file } = await setup();
    await seed(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "create" });
    await seed(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "append" });
    expect(count(file, "customers")).toBe(10);
    await seed(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "truncate" });
    expect(count(file, "customers")).toBe(5);
  });

  test("failure rolls back the current table and reports table and batch", async () => {
    const { app, c, conn, file } = await setup();
    const db = new Database(file);
    db.exec(`CREATE TABLE "customers" ("id" INTEGER, "first_name" TEXT, "country" TEXT, "extra" TEXT NOT NULL)`);
    db.close();
    const { events } = await seed(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "append" });
    const err = events.find((e) => e.type === "error")!;
    expect(err).toMatchObject({ table: "customers", batch: 1 });
    expect(String(err.message)).toContain("NOT NULL");
    expect(events.at(-1)).toEqual({ type: "done", ok: false, warnings: 0 });
    expect(count(file, "customers")).toBe(0);
  });

  test("SSE stream replays all events and ends", async () => {
    const { app, c, conn } = await setup();
    const { jobId } = await seed(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "create" });
    const r = await app.inject({ method: "GET", url: `/api/seed/${jobId}/events` });
    expect(r.headers["content-type"]).toContain("text/event-stream");
    const events = r.body.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
    expect(events[0].type).toBe("start");
    expect(events.at(-1).type).toBe("done");
  });

  test("request validation", async () => {
    const { app, c, o, conn } = await setup();
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/seed", payload });
    expect((await post({ connectionId: conn.id, schemas: [{ id: c.id }], mode: "upsert" })).statusCode).toBe(400);
    expect((await post({ connectionId: "nope", schemas: [{ id: c.id }], mode: "create" })).statusCode).toBe(404);
    expect((await post({ connectionId: conn.id, schemas: [{ id: o.id }, { id: c.id, count: 6 }], mode: "create" })).statusCode).toBe(400);
    expect((await post({ connectionId: conn.id, schemas: [], mode: "create" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/seed/nope" })).statusCode).toBe(404);
  });

  test("connection errors end the job with an error event", async () => {
    const { app, c } = await setup();
    const conn = (
      await app.inject({ method: "POST", url: "/api/connections", payload: { name: "PG", kind: "pg", host: "127.0.0.1", port: 1, database: "x", user: "x" } })
    ).json();
    const { events } = await seed(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "create" });
    expect(events.map((e) => e.type)).toEqual(["error", "done"]);
    expect(events.at(-1)).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/server test seed.test`
Expected: FAIL with 404 on `POST /api/seed`.

- [ ] **Step 3: Implement the runner**

`apps/server/src/seed/runner.ts`:
```ts
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  DataGenerator, createTableSql, deleteRowsSql, flattenColumns, insertStatements, type Schema,
} from "@mockgen/core";
import type { ExportItem } from "../export-plan.ts";
import type { SeedTarget } from "./targets.ts";

export type SeedMode = "create" | "append" | "truncate";
export const SEED_MODES: readonly SeedMode[] = ["create", "append", "truncate"];
export const SEED_BATCH = 500;

export type SeedEvent =
  | { type: "start"; tables: { table: string; total: number }[] }
  | { type: "progress"; table: string; inserted: number; total: number }
  | { type: "table-done"; table: string; inserted: number }
  | { type: "error"; table: string; batch: number; message: string }
  | { type: "done"; ok: boolean; warnings: number };

export interface SeedPlan {
  all: Schema[];
  items: ExportItem[];
  seed: number;
  mode: SeedMode;
}

export async function runSeed(target: SeedTarget, plan: SeedPlan, emit: (e: SeedEvent) => void): Promise<boolean> {
  const gen = new DataGenerator(plan.all);
  const tables = plan.items.map((item) => ({ item, table: item.schema.slug, columns: flattenColumns(item.schema.fields, plan.all) }));
  emit({ type: "start", tables: tables.map((t) => ({ table: t.table, total: t.item.count })) });

  let current = "";
  let batch = 0;
  try {
    if (plan.mode === "create") {
      for (const t of tables) {
        current = t.table;
        await target.exec(createTableSql(t.table, t.columns, target.dialect));
      }
    }
    if (plan.mode === "truncate") {
      await target.begin();
      for (const t of [...tables].reverse()) {
        current = t.table;
        await target.exec(deleteRowsSql(t.table, target.dialect));
      }
      await target.commit();
    }
    for (const t of tables) {
      current = t.table;
      batch = 0;
      const total = t.item.count;
      await target.begin();
      const rows = gen.rows(t.item.schema.id, total, plan.seed);
      for (const stmt of insertStatements(t.table, t.columns, rows, target.dialect, SEED_BATCH)) {
        batch++;
        await target.exec(stmt);
        emit({ type: "progress", table: t.table, inserted: Math.min(batch * SEED_BATCH, total), total });
        await yieldToEventLoop();
      }
      await target.commit();
      emit({ type: "table-done", table: t.table, inserted: total });
    }
    emit({ type: "done", ok: true, warnings: gen.warnings });
    return true;
  } catch (e) {
    await target.rollback().catch(() => {});
    emit({ type: "error", table: current, batch, message: (e as Error).message });
    emit({ type: "done", ok: false, warnings: gen.warnings });
    return false;
  }
}
```

- [ ] **Step 4: Implement the job store**

`apps/server/src/seed/jobs.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { SeedEvent } from "./runner.ts";

const MAX_JOBS = 20;

export interface SeedJob {
  id: string;
  events: SeedEvent[];
  done: boolean;
}

interface Entry extends SeedJob {
  listeners: Set<(e: SeedEvent) => void>;
}

export class SeedJobs {
  readonly #jobs = new Map<string, Entry>();

  create(): SeedJob {
    const job: Entry = { id: randomUUID(), events: [], done: false, listeners: new Set() };
    this.#jobs.set(job.id, job);
    while (this.#jobs.size > MAX_JOBS) this.#jobs.delete(this.#jobs.keys().next().value!);
    return job;
  }

  get(id: string): SeedJob | undefined {
    return this.#jobs.get(id);
  }

  emit(job: SeedJob, e: SeedEvent): void {
    const entry = job as Entry;
    entry.events.push(e);
    if (e.type === "done") entry.done = true;
    for (const fn of entry.listeners) fn(e);
  }

  subscribe(job: SeedJob, fn: (e: SeedEvent) => void): () => void {
    const entry = job as Entry;
    entry.listeners.add(fn);
    return () => entry.listeners.delete(fn);
  }
}
```

- [ ] **Step 5: Implement the routes**

`apps/server/src/routes/seed.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.ts";
import { HttpError } from "../errors.ts";
import { resolveExport } from "../export-plan.ts";
import { SEED_MODES, runSeed, type SeedEvent, type SeedMode } from "../seed/runner.ts";
import { openTarget, type SeedTarget } from "../seed/targets.ts";
import { requireConnection } from "./connections.ts";

interface SeedBody {
  connectionId?: string;
  schemas?: { id: string; count?: number }[];
  mode?: string;
  seed?: number;
}

export function seedRoutes(app: FastifyInstance, ctx: AppContext) {
  const requireJob = (id: string) => {
    const job = ctx.seedJobs.get(id);
    if (!job) throw new HttpError(404, `Seed job ${id} not found`);
    return job;
  };

  app.post<{ Body: SeedBody }>("/api/seed", async (req, reply) => {
    const body = req.body ?? {};
    if (!SEED_MODES.includes(body.mode as SeedMode)) throw new HttpError(400, `mode must be one of ${SEED_MODES.join(", ")}`);
    const conn = requireConnection(ctx, String(body.connectionId));
    const all = ctx.schemas.all();
    const { items, seed } = resolveExport(all, body.schemas ?? [], { maxRows: ctx.config.maxRows, seed: body.seed });
    const job = ctx.seedJobs.create();
    const emit = (e: SeedEvent) => ctx.seedJobs.emit(job, e);

    void (async () => {
      let target: SeedTarget | undefined;
      try {
        target = await openTarget(conn, { dataDir: ctx.config.dataDir, env: process.env });
        await runSeed(target, { all, items, seed, mode: body.mode as SeedMode }, emit);
      } catch (e) {
        emit({ type: "error", table: "", batch: 0, message: (e as Error).message });
        emit({ type: "done", ok: false, warnings: 0 });
      } finally {
        await target?.close().catch(() => {});
      }
    })();

    return reply.status(202).send({ jobId: job.id });
  });

  app.get<{ Params: { jobId: string } }>("/api/seed/:jobId", async (req) => {
    const job = requireJob(req.params.jobId);
    return { id: job.id, done: job.done, events: job.events };
  });

  app.get<{ Params: { jobId: string } }>("/api/seed/:jobId/events", (req, reply) => {
    const job = requireJob(req.params.jobId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: SeedEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const e of job.events) send(e);
    if (job.done) return void res.end();
    const unsubscribe = ctx.seedJobs.subscribe(job, (e) => {
      send(e);
      if (e.type === "done") {
        unsubscribe();
        res.end();
      }
    });
    req.raw.on("close", unsubscribe);
  });
}
```

In `apps/server/src/app.ts`:
- add imports `import { SeedJobs } from "./seed/jobs.ts";` and `import { seedRoutes } from "./routes/seed.ts";`
- add `seedJobs: SeedJobs;` to `AppContext` and `seedJobs: new SeedJobs()` to `ctx`
- register `seedRoutes(app, ctx);` after `connectionRoutes(app, ctx);`

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): background database seeding with SSE progress"
```

---

### Task 3: Integration tests against real PostgreSQL and SQL Server

**Files:**
- Create: `apps/server/test/seed.integration.test.ts`, `apps/server/vitest.it.config.ts`
- Modify: `apps/server/package.json` (add `test:it` script)

**Interfaces:**
- Consumes: everything from Tasks 1–2 via HTTP (`app.inject`), test helpers from Part 2.
- Produces: no production code. If these tests expose a dialect bug (for example a literal format SQL Server rejects), fix it in `packages/core/src/formats/sql.ts` with a new failing unit test in `packages/core/test/formats.test.ts` first.

- [ ] **Step 1: Add the integration config and script**

`apps/server/vitest.it.config.ts` (sets `SEED_IT` for the test process, so the script works the same in cmd, PowerShell and bash):
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/seed.integration.test.ts"],
    env: { SEED_IT: "1" },
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
```

In `apps/server/package.json` `scripts` add:
```json
    "test:it": "vitest run --config vitest.it.config.ts"
```

- [ ] **Step 2: Write the integration test**

`apps/server/test/seed.integration.test.ts`:
```ts
import { MSSQLServerContainer, type StartedMSSQLServerContainer } from "@testcontainers/mssqlserver";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import sql from "mssql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createSchema, makeApp } from "./helpers.ts";

const RUN = process.env.SEED_IT === "1";

const richCustomers = {
  name: "Customers",
  slug: "customers",
  defaultCount: 50,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "uid", type: "uuid" },
    { name: "name", type: "person.fullName" },
    { name: "active", type: "boolean" },
    { name: "balance", type: "number", options: { min: 0, max: 1000, decimals: 2 } },
    { name: "joined", type: "date.between", options: { format: "datetime" } },
    { name: "born", type: "date.birthdate" },
    { name: "address", type: "object", children: [{ name: "city", type: "location.city" }] },
    { name: "tags", type: "array", children: [{ name: "t", type: "word.noun" }] },
    { name: "note", type: "lorem.sentence", blankPercent: 30 },
  ],
};

const orders = (customerId: string) => ({
  name: "Orders",
  slug: "orders",
  defaultCount: 1200,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "customer_id", type: "reference", options: { schemaId: customerId, fieldName: "id" } },
    { name: "customer_uid", type: "reference", options: { schemaId: customerId, fieldName: "uid" } },
  ],
});

async function runJob(app: FastifyInstance, body: object) {
  const { jobId } = (await app.inject({ method: "POST", url: "/api/seed", payload: body })).json();
  for (let i = 0; i < 1200; i++) {
    const job = (await app.inject({ method: "GET", url: `/api/seed/${jobId}` })).json();
    if (job.done) return job.events as { type: string; [k: string]: unknown }[];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
}

async function scenario(app: FastifyInstance, connection: object, countRows: (table: string) => Promise<number>) {
  const c = await createSchema(app, richCustomers);
  const o = await createSchema(app, orders(c.id));
  const conn = (await app.inject({ method: "POST", url: "/api/connections", payload: connection })).json();

  const created = await runJob(app, { connectionId: conn.id, schemas: [{ id: o.id }], mode: "create" });
  expect(created.at(-1), JSON.stringify(created.filter((e) => e.type === "error"))).toEqual({ type: "done", ok: true, warnings: 0 });
  expect(await countRows("customers")).toBe(50);
  expect(await countRows("orders")).toBe(1200);

  await runJob(app, { connectionId: conn.id, schemas: [{ id: c.id }], mode: "append" });
  expect(await countRows("customers")).toBe(100);

  const truncated = await runJob(app, { connectionId: conn.id, schemas: [{ id: o.id }], mode: "truncate" });
  expect(truncated.at(-1)).toMatchObject({ ok: true });
  expect(await countRows("customers")).toBe(50);
  expect(await countRows("orders")).toBe(1200);
}

describe.runIf(RUN)("seeding PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 180_000);
  afterAll(async () => container?.stop());

  test("create, append, truncate", async () => {
    process.env.IT_PG_PASSWORD = container.getPassword();
    const app = await makeApp();
    const client = new pg.Client({
      host: container.getHost(), port: container.getPort(), database: container.getDatabase(),
      user: container.getUsername(), password: container.getPassword(),
    });
    await client.connect();
    try {
      await scenario(
        app,
        {
          name: "PG", kind: "pg", host: container.getHost(), port: container.getPort(),
          database: container.getDatabase(), user: container.getUsername(), password: "${IT_PG_PASSWORD}",
        },
        async (t) => Number((await client.query(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n),
      );
    } finally {
      await client.end();
    }
  }, 180_000);
});

describe.runIf(RUN)("seeding SQL Server", () => {
  let container: StartedMSSQLServerContainer;
  beforeAll(async () => {
    container = await new MSSQLServerContainer("mcr.microsoft.com/mssql/server:2022-latest").acceptLicense().start();
  }, 300_000);
  afterAll(async () => container?.stop());

  test("create, append, truncate", async () => {
    const app = await makeApp();
    const pool = await new sql.ConnectionPool({
      server: container.getHost(), port: container.getPort(), database: container.getDatabase(),
      user: container.getUsername(), password: container.getPassword(),
      options: { encrypt: false, trustServerCertificate: true },
    }).connect();
    try {
      await scenario(
        app,
        {
          name: "MSSQL", kind: "mssql", host: container.getHost(), port: container.getPort(),
          database: container.getDatabase(), user: container.getUsername(), password: container.getPassword(),
          encrypt: false,
        },
        async (t) => (await pool.request().query(`SELECT COUNT(*) AS n FROM [${t}]`)).recordset[0].n as number,
      );
    } finally {
      await pool.close();
    }
  }, 300_000);
});
```

- [ ] **Step 3: Run the integration tests**

Ensure Docker Desktop is running.

Run: `pnpm --filter @mockgen/server test:it`
Expected: both suites PASS (first run pulls `postgres:17-alpine` and the SQL Server image, which can take several minutes). If a dialect error appears in an `error` event (the assertion message prints it), fix it in core's SQL formatter test-first as described in **Interfaces**, then re-run both `pnpm --filter @mockgen/core test` and this command.

Run: `pnpm --filter @mockgen/server test`
Expected: PASS, with the integration suites reported as skipped (no `SEED_IT`).

- [ ] **Step 4: Commit**

```bash
git add apps/server packages/core
git commit -m "test(server): seeding integration tests against PostgreSQL and SQL Server"
```
