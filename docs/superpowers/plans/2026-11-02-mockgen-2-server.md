# mockgen Part 2: Server (Schemas, Generate, Mock API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@mockgen/server`, a Fastify app that stores schemas in SQLite and exposes the schema CRUD API, preview, file generation (single file or multi-schema SQL/zip), the stable read-only mock API, OpenAPI docs, and hosting for the built web UI.

**Architecture:** `apps/server` depends on `@mockgen/core` (Part 1). `buildApp({ config, db })` wires a `SchemaRepo` (better-sqlite3) and registers route modules. Each route module is a function `(app, ctx) => void`. Generation streams core's string chunks through `Readable.from`; multi-file exports are zipped with `yazl`. Node runs the TypeScript directly (`node apps/server/src/main.ts`).

**Tech Stack:** Node 24+, Fastify 5.12.8, better-sqlite3 13.0.3, yazl 3.3.1, @fastify/swagger 9.9.3, @fastify/swagger-ui 6.1.2, @fastify/static 10.1.8, Vitest 5 (`app.inject`), adm-zip 0.6.1 (tests only).

**Spec:** `docs/superpowers/specs/2026-11-02-mockgen-design.md`

**Plan series:** Part 1 Core → **Part 2 Server (this)** → Part 3 Seeding → Part 4 Web UI & Docker. Requires Part 1 complete.

## Global Constraints

- Erasable-only TypeScript, ESM, `.ts` import extensions (same as Part 1). `tsconfig` extends `../../tsconfig.base.json`.
- Environment variables: `PORT` (default `8080`), `DATA_DIR` (default `/data`), `MAX_ROWS` (default `1000000`), `MOCK_SCAN_LIMIT` (default `10000`), `WEB_DIR` (default `apps/web/dist` resolved from the server source; ignored if missing). Host is always `0.0.0.0`.
- Database file: `<DATA_DIR>/mockgen.db`.
- Validation errors: HTTP 400 `{ "errors": [{ "path": "fields[3].options.min", "message": "..." }] }`. Other client errors: `{ "error": "..." }` with 400/404/409. Unexpected errors: 500 `{ "error": "Internal server error" }`, logged.
- Limits: `count ≤ MAX_ROWS`; preview ≤ 100 rows (default 10); mock `pageSize` 1–1000 (default 20).
- Multi-schema exports use **one shared seed**: `body.seed ?? <first requested schema>.seed`. A schema referenced by another schema in the same export must use its `defaultCount`; a different explicit count is a 400.
- Formula warning counts are returned by preview (`{ rows, warnings }`); for downloads they are only logged.
- Mock API: only schemas with `mockEnabled: true`; by-id lookups require a top-level field named `id` of type `rowNumber`; writes return realistic responses and store nothing.

## File Structure

```
apps/server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/main.ts                 process entry: config → db → app.listen
  src/config.ts               loadConfig(env)
  src/db.ts                   openDb(file) + migrations
  src/errors.ts               HttpError, ValidationFailed, errorHandler
  src/app.ts                  buildApp({ config, db, logger }) + AppContext
  src/repo/schemas.ts         SchemaRepo
  src/export-plan.ts          resolveExport(): ids, counts, seed for multi-schema output
  src/routes/health.ts
  src/routes/types.ts         GET /api/types
  src/routes/schemas.ts       /api/schemas CRUD
  src/routes/preview.ts       POST /api/preview
  src/routes/generate.ts      GET /api/schemas/:id/generate, POST /api/generate
  src/routes/mock.ts          /mock/:slug[/:id]
  src/routes/docs.ts          OpenAPI + Swagger UI
  src/routes/web.ts           static UI + SPA fallback / JSON 404
  test/helpers.ts
  test/*.test.ts
```

---

### Task 1: Server scaffold: config, database, schema repo, error handling, health

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`
- Create: `apps/server/src/config.ts`, `apps/server/src/db.ts`, `apps/server/src/errors.ts`, `apps/server/src/repo/schemas.ts`, `apps/server/src/app.ts`, `apps/server/src/routes/health.ts`
- Test: `apps/server/test/helpers.ts`, `apps/server/test/config.test.ts`, `apps/server/test/repo.test.ts`, `apps/server/test/health.test.ts`

**Interfaces:**
- Consumes: from `@mockgen/core`: `Schema`, `SchemaSchema`, `ValidationIssue`.
- Produces:
  - `interface Config { port: number; host: string; dataDir: string; maxRows: number; mockScanLimit: number; webDir: string | null }`; `loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `type Db = Database.Database`; `openDb(file: string): Db` (`":memory:"` allowed)
  - `class HttpError extends Error { statusCode: number }`; `class ValidationFailed extends Error { issues: ValidationIssue[] }`; `errorHandler` (Fastify error handler)
  - `class SchemaRepo { all(): Schema[]; get(id): Schema | undefined; getBySlug(slug): Schema | undefined; save(schema: Schema): void; delete(id): boolean }`
  - `interface AppContext { config: Config; db: Db; schemas: SchemaRepo }`; `buildApp(opts: { config: Config; db: Db; logger?: boolean }): Promise<FastifyInstance>`
  - Test helpers: `testConfig(over?)`, `makeApp(over?)`, `createSchema(app, body)`, `customersInput`, `ordersInput(customerId)`

- [ ] **Step 1: Create the package**

`apps/server/package.json`:
```json
{
  "name": "@mockgen/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node --disable-warning=ExperimentalWarning src/main.ts",
    "dev": "node --watch --disable-warning=ExperimentalWarning src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@fastify/static": "10.1.8",
    "@fastify/swagger": "9.9.3",
    "@fastify/swagger-ui": "6.1.2",
    "@mockgen/core": "workspace:*",
    "better-sqlite3": "13.0.3",
    "fastify": "5.12.8",
    "yazl": "3.3.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/adm-zip": "0.6.0",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "24.19.2",
    "@types/yazl": "3.3.1",
    "adm-zip": "0.6.1",
    "typescript": "7.0.2",
    "vitest": "5.0.5"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

`apps/server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});
```

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 2: Write test helpers and failing tests**

`apps/server/test/helpers.ts`:
```ts
import os from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { openDb } from "../src/db.ts";

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir: os.tmpdir(),
    maxRows: 1000,
    mockScanLimit: 10_000,
    webDir: null,
    ...over,
  };
}

export async function makeApp(over: Partial<Config> = {}): Promise<FastifyInstance> {
  return buildApp({ config: testConfig(over), db: openDb(":memory:"), logger: false });
}

export async function createSchema(app: FastifyInstance, body: unknown): Promise<{ id: string; [k: string]: unknown }> {
  const r = await app.inject({ method: "POST", url: "/api/schemas", payload: body as object });
  if (r.statusCode !== 201) throw new Error(`createSchema failed: ${r.statusCode} ${r.body}`);
  return r.json();
}

export const customersInput = {
  name: "Customers",
  slug: "customers",
  defaultCount: 5,
  seed: 7,
  mockEnabled: true,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "first_name", type: "person.firstName" },
    { name: "country", type: "customList", options: { values: [{ value: "DK" }, { value: "SE" }] } },
  ],
};

export const ordersInput = (customerId: string) => ({
  name: "Orders",
  slug: "orders",
  defaultCount: 20,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "customer_id", type: "reference", options: { schemaId: customerId, fieldName: "id" } },
    { name: "qty", type: "number", options: { min: 1, max: 5 } },
  ],
});
```

`apps/server/test/config.test.ts`:
```ts
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  test("defaults", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ port: 8080, host: "0.0.0.0", dataDir: "/data", maxRows: 1_000_000, mockScanLimit: 10_000 });
  });

  test("reads env", () => {
    const c = loadConfig({ PORT: "9000", DATA_DIR: "./d", MAX_ROWS: "50", MOCK_SCAN_LIMIT: "7", WEB_DIR: "/nope" });
    expect(c.port).toBe(9000);
    expect(c.dataDir).toBe(path.resolve("./d"));
    expect(c.maxRows).toBe(50);
    expect(c.mockScanLimit).toBe(7);
    expect(c.webDir).toBeNull(); // missing directory is ignored
  });

  test("rejects invalid numbers", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow("PORT");
    expect(() => loadConfig({ MAX_ROWS: "0" })).toThrow("MAX_ROWS");
  });
});
```

`apps/server/test/repo.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema } from "@mockgen/core";
import { openDb } from "../src/db.ts";
import { SchemaRepo } from "../src/repo/schemas.ts";

const s = (id: string, slug: string, name = slug) =>
  SchemaSchema.parse({ id, name, slug, fields: [{ name: "id", type: "rowNumber" }] });

describe("SchemaRepo", () => {
  test("save, get, getBySlug, all (sorted by name), update, delete", () => {
    const repo = new SchemaRepo(openDb(":memory:"));
    repo.save(s("1", "zeta", "Zeta"));
    repo.save(s("2", "alpha", "Alpha"));
    expect(repo.all().map((x) => x.slug)).toEqual(["alpha", "zeta"]);
    expect(repo.get("1")?.slug).toBe("zeta");
    expect(repo.getBySlug("alpha")?.id).toBe("2");
    repo.save({ ...s("1", "omega", "Omega") });
    expect(repo.get("1")?.slug).toBe("omega");
    expect(repo.getBySlug("zeta")).toBeUndefined();
    expect(repo.delete("1")).toBe(true);
    expect(repo.delete("1")).toBe(false);
    expect(repo.all()).toHaveLength(1);
  });
});
```

`apps/server/test/health.test.ts`:
```ts
import { expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

test("GET /health", async () => {
  const app = await makeApp();
  const r = await app.inject({ method: "GET", url: "/health" });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: "ok" });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @mockgen/server test`
Expected: FAIL, cannot resolve `../src/config.ts` etc.

- [ ] **Step 4: Implement config, db, errors and repo**

`apps/server/src/config.ts`:
```ts
import fs from "node:fs";
import path from "node:path";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  maxRows: number;
  mockScanLimit: number;
  webDir: string | null;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const defaultWeb = path.resolve(import.meta.dirname, "../../web/dist");
  const webDir = path.resolve(env.WEB_DIR || defaultWeb);
  return {
    port: positiveInt(env, "PORT", 8080),
    host: "0.0.0.0",
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : "/data",
    maxRows: positiveInt(env, "MAX_ROWS", 1_000_000),
    mockScanLimit: positiveInt(env, "MOCK_SCAN_LIMIT", 10_000),
    webDir: fs.existsSync(path.join(webDir, "index.html")) ? webDir : null,
  };
}
```

`apps/server/src/db.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const MIGRATIONS = [
  `CREATE TABLE schemas (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE connections (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
];

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  const version = db.pragma("user_version", { simple: true }) as number;
  db.transaction(() => {
    for (let i = version; i < MIGRATIONS.length; i++) db.exec(MIGRATIONS[i]!);
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  })();
  return db;
}
```

`apps/server/src/errors.ts`:
```ts
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ValidationIssue } from "@mockgen/core";

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class ValidationFailed extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("Validation failed");
    this.issues = issues;
  }
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ValidationFailed) return reply.status(400).send({ errors: err.issues });
  if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
  const status = (err as FastifyError).statusCode;
  if (status && status >= 400 && status < 500) return reply.status(status).send({ error: err.message });
  req.log.error(err);
  return reply.status(500).send({ error: "Internal server error" });
}
```

`apps/server/src/repo/schemas.ts`:
```ts
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
```

- [ ] **Step 5: Implement the app and health route**

`apps/server/src/routes/health.ts`:
```ts
import type { FastifyInstance } from "fastify";

export function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));
}
```

`apps/server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { errorHandler } from "./errors.ts";
import { SchemaRepo } from "./repo/schemas.ts";
import { healthRoutes } from "./routes/health.ts";

export interface AppContext {
  config: Config;
  db: Db;
  schemas: SchemaRepo;
}

export async function buildApp(opts: { config: Config; db: Db; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });
  const ctx: AppContext = { config: opts.config, db: opts.db, schemas: new SchemaRepo(opts.db) };
  app.setErrorHandler(errorHandler);
  healthRoutes(app);
  void ctx;
  return app;
}
```

(`void ctx` is temporary; Task 2 starts passing `ctx` to routes and removes it.)

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): scaffold Fastify app with SQLite schema repo"
```

---

### Task 2: Schema CRUD and type metadata API

**Files:**
- Create: `apps/server/src/routes/schemas.ts`, `apps/server/src/routes/types.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/schemas.test.ts`, `apps/server/test/types.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `HttpError`, `ValidationFailed` (Task 1); from core: `validateSchema`, `referencedSchemaIds`, `describeFieldTypes`, `LOCALES`, `FORMATS`, `DIALECTS`, `HELPER_NAMES`.
- Produces:
  - `schemaRoutes(app, ctx)`: `GET /api/schemas` → `Schema[]`; `GET /api/schemas/:id` → `Schema` | 404; `POST /api/schemas` (body without `id`; server assigns UUID) → 201 `Schema` | 400; `PUT /api/schemas/:id` → 200 `Schema` | 400 | 404; `DELETE /api/schemas/:id` → 204 | 404 | 409 (referenced by others).
  - `typeRoutes(app)`: `GET /api/types` → `{ types: FieldTypeInfo[]; locales: string[]; formats: Format[]; dialects: Dialect[]; helpers: string[] }`
  - `requireSchema(ctx, id): Schema` (throws 404) exported from `routes/schemas.ts` for reuse.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/schemas.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { createSchema, customersInput, makeApp, ordersInput } from "./helpers.ts";

describe("/api/schemas", () => {
  test("create assigns id and defaults, then get and list", async () => {
    const app = await makeApp();
    const created = await createSchema(app, customersInput);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.locale).toBe("en");
    const one = await app.inject({ method: "GET", url: `/api/schemas/${created.id}` });
    expect(one.json().slug).toBe("customers");
    const list = await app.inject({ method: "GET", url: "/api/schemas" });
    expect(list.json()).toHaveLength(1);
  });

  test("create ignores a client-supplied id", async () => {
    const app = await makeApp();
    const created = await createSchema(app, { ...customersInput, id: "mine" });
    expect(created.id).not.toBe("mine");
  });

  test("validation errors return 400 with paths", async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/schemas",
      payload: { ...customersInput, fields: [{ name: "x", type: "number", options: { min: 9, max: 1 } }] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ errors: [{ path: "fields[0].options.min", message: expect.any(String) }] });
  });

  test("duplicate slug is rejected", async () => {
    const app = await makeApp();
    await createSchema(app, customersInput);
    const r = await app.inject({ method: "POST", url: "/api/schemas", payload: customersInput });
    expect(r.statusCode).toBe(400);
    expect(r.json().errors[0].path).toBe("slug");
  });

  test("update replaces the schema and keeps the id", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const r = await app.inject({ method: "PUT", url: `/api/schemas/${c.id}`, payload: { ...customersInput, name: "Clients" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: c.id, name: "Clients" });
  });

  test("404s", async () => {
    const app = await makeApp();
    expect((await app.inject({ method: "GET", url: "/api/schemas/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/api/schemas/nope", payload: customersInput })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/schemas/nope" })).statusCode).toBe(404);
  });

  test("delete is blocked while another schema references it", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const o = await createSchema(app, ordersInput(c.id));
    const blocked = await app.inject({ method: "DELETE", url: `/api/schemas/${c.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toContain("orders");
    expect((await app.inject({ method: "DELETE", url: `/api/schemas/${o.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/schemas/${c.id}` })).statusCode).toBe(204);
  });
});
```

`apps/server/test/types.test.ts`:
```ts
import { expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

test("GET /api/types", async () => {
  const app = await makeApp();
  const r = await app.inject({ method: "GET", url: "/api/types" });
  expect(r.statusCode).toBe(200);
  const body = r.json();
  expect(body.types.length).toBeGreaterThan(90);
  expect(body.types.find((t: { key: string }) => t.key === "formula").kind).toBe("formula");
  expect(body.locales).toContain("da");
  expect(body.formats).toEqual(["csv", "json", "ndjson", "sql"]);
  expect(body.dialects).toEqual(["pg", "mssql", "sqlite"]);
  expect(body.helpers).toContain("lower");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mockgen/server test schemas types`
Expected: FAIL with 404 responses (routes not registered).

- [ ] **Step 3: Implement the routes**

`apps/server/src/routes/schemas.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { referencedSchemaIds, validateSchema, type Schema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { HttpError, ValidationFailed } from "../errors.ts";

export function requireSchema(ctx: AppContext, id: string): Schema {
  const schema = ctx.schemas.get(id);
  if (!schema) throw new HttpError(404, `Schema ${id} not found`);
  return schema;
}

function validated(ctx: AppContext, body: unknown, id: string): Schema {
  const input = { ...(typeof body === "object" && body !== null ? body : {}), id };
  const { schema, issues } = validateSchema(input, ctx.schemas.all());
  if (!schema) throw new ValidationFailed(issues);
  return schema;
}

export function schemaRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/schemas", async () => ctx.schemas.all());

  app.get<{ Params: { id: string } }>("/api/schemas/:id", async (req) => requireSchema(ctx, req.params.id));

  app.post("/api/schemas", async (req, reply) => {
    const schema = validated(ctx, req.body, randomUUID());
    ctx.schemas.save(schema);
    return reply.status(201).send(schema);
  });

  app.put<{ Params: { id: string } }>("/api/schemas/:id", async (req) => {
    requireSchema(ctx, req.params.id);
    const schema = validated(ctx, req.body, req.params.id);
    ctx.schemas.save(schema);
    return schema;
  });

  app.delete<{ Params: { id: string } }>("/api/schemas/:id", async (req, reply) => {
    const schema = requireSchema(ctx, req.params.id);
    const dependents = ctx.schemas.all().filter((s) => s.id !== schema.id && referencedSchemaIds(s).includes(schema.id));
    if (dependents.length) {
      throw new HttpError(409, `Schema is referenced by: ${dependents.map((s) => s.slug).join(", ")}`);
    }
    ctx.schemas.delete(schema.id);
    return reply.status(204).send();
  });
}
```

`apps/server/src/routes/types.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { DIALECTS, FORMATS, HELPER_NAMES, LOCALES, describeFieldTypes } from "@mockgen/core";

export function typeRoutes(app: FastifyInstance) {
  const body = {
    types: describeFieldTypes(),
    locales: LOCALES,
    formats: FORMATS,
    dialects: DIALECTS,
    helpers: [...HELPER_NAMES],
  };
  app.get("/api/types", async () => body);
}
```

Update `apps/server/src/app.ts` (replace the body of `buildApp` after `setErrorHandler`):
```ts
import { schemaRoutes } from "./routes/schemas.ts";
import { typeRoutes } from "./routes/types.ts";
// ...
  app.setErrorHandler(errorHandler);
  healthRoutes(app);
  typeRoutes(app);
  schemaRoutes(app, ctx);
  return app;
```
Remove the `void ctx;` line.

- [ ] **Step 4: Run tests and type check**

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): schema CRUD and field type metadata API"
```

---

### Task 3: Preview and file generation (single and multi-schema)

**Files:**
- Create: `apps/server/src/export-plan.ts`, `apps/server/src/routes/preview.ts`, `apps/server/src/routes/generate.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/export-plan.test.ts`, `apps/server/test/preview.test.ts`, `apps/server/test/generate.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `HttpError`, `ValidationFailed`, `requireSchema` (Tasks 1–2); from core: `DataGenerator`, `validateSchema`, `withDependencies`, `referencedSchemaIds`, `formatRows`, `FORMATS`, `FORMAT_MIME`, `DIALECTS`, `Format`, `Dialect`, `Schema`.
- Produces:
  - `interface ExportItem { schema: Schema; count: number }`
  - `resolveExport(all: Schema[], requested: { id: string; count?: number }[], opts: { maxRows: number; seed?: number }): { items: ExportItem[]; seed: number }` (parent-first; throws `HttpError` 404 for unknown ids, 400 for bad counts) — reused by Part 3 seeding.
  - `parseFormat(v: unknown): Format`, `parseDialect(v: unknown): Dialect`, `parseCount(v: unknown, fallback: number, maxRows: number): number` (all throw `HttpError(400)`), exported from `routes/generate.ts`.
  - `POST /api/preview` body `{ schema: SchemaInput (id optional), count?: number }` → `{ rows: Row[]; warnings: number }` | 400 `{ errors }`.
  - `GET /api/schemas/:id/generate?format&dialect&count&seed&ddl` → streamed file with `Content-Disposition: attachment; filename="<slug>.<ext>"`.
  - `POST /api/generate` body `{ schemaIds: string[]; counts?: Record<string, number>; format: Format; dialect?: Dialect; seed?: number; ddl?: boolean }` → `mockgen.sql` (format sql) or `mockgen.zip` (other formats; one `<slug>.<ext>` per schema).

- [ ] **Step 1: Write the failing tests**

`apps/server/test/export-plan.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { SchemaSchema } from "@mockgen/core";
import { resolveExport } from "../src/export-plan.ts";

const customers = SchemaSchema.parse({ id: "c", name: "C", slug: "customers", defaultCount: 5, seed: 3, fields: [{ name: "id", type: "rowNumber" }] });
const orders = SchemaSchema.parse({
  id: "o", name: "O", slug: "orders", defaultCount: 20, seed: 9,
  fields: [{ name: "id", type: "rowNumber" }, { name: "c", type: "reference", options: { schemaId: "c", fieldName: "id" } }],
});
const all = [customers, orders];

describe("resolveExport", () => {
  test("adds dependencies parent-first with default counts and first requested seed", () => {
    const r = resolveExport(all, [{ id: "o" }], { maxRows: 1000 });
    expect(r.items.map((i) => [i.schema.slug, i.count])).toEqual([["customers", 5], ["orders", 20]]);
    expect(r.seed).toBe(9);
  });

  test("explicit seed and count on a non-referenced schema", () => {
    const r = resolveExport(all, [{ id: "o", count: 50 }], { maxRows: 1000, seed: 1 });
    expect(r.items[1]!.count).toBe(50);
    expect(r.seed).toBe(1);
  });

  test("referenced schema count must equal defaultCount", () => {
    expect(() => resolveExport(all, [{ id: "o" }, { id: "c", count: 6 }], { maxRows: 1000 })).toThrow("customers");
    expect(resolveExport(all, [{ id: "o" }, { id: "c", count: 5 }], { maxRows: 1000 }).items).toHaveLength(2);
  });

  test("limits and unknown ids", () => {
    expect(() => resolveExport(all, [{ id: "o", count: 1001 }], { maxRows: 1000 })).toThrow("1000");
    expect(() => resolveExport(all, [{ id: "x" }], { maxRows: 1000 })).toThrow("x");
    expect(() => resolveExport(all, [], { maxRows: 1000 })).toThrow();
  });
});
```

`apps/server/test/preview.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { createSchema, customersInput, makeApp, ordersInput } from "./helpers.ts";

describe("POST /api/preview", () => {
  test("returns 10 rows by default for an unsaved schema, never more than defaultCount", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "POST", url: "/api/preview", payload: { schema: { ...customersInput, defaultCount: 50 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().rows).toHaveLength(10);
    expect(r.json().warnings).toBe(0);
    const small = await app.inject({ method: "POST", url: "/api/preview", payload: { schema: customersInput } });
    expect(small.json().rows).toHaveLength(5);
  });

  test("caps at 100 rows and resolves references to saved schemas", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const r = await app.inject({
      method: "POST",
      url: "/api/preview",
      payload: { schema: { ...ordersInput(c.id), defaultCount: 1000 }, count: 500 },
    });
    const rows = r.json().rows as { customer_id: number }[];
    expect(rows).toHaveLength(100);
    expect(rows.every((x) => x.customer_id >= 1 && x.customer_id <= 5)).toBe(true);
  });

  test("previewing a saved schema's edit does not trip the duplicate-slug check", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const r = await app.inject({ method: "POST", url: "/api/preview", payload: { schema: { ...c, name: "Edited" } } });
    expect(r.statusCode).toBe(200);
  });

  test("reports validation errors and formula warnings", async () => {
    const app = await makeApp();
    const bad = await app.inject({
      method: "POST",
      url: "/api/preview",
      payload: { schema: { ...customersInput, fields: [{ name: "f", type: "formula", options: { expression: "nope" } }] } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].path).toBe("fields[0].options.expression");

    const warn = await app.inject({
      method: "POST",
      url: "/api/preview",
      payload: {
        schema: {
          ...customersInput,
          fields: [
            { name: "z", type: "number", options: { min: 0, max: 0 } },
            { name: "f", type: "formula", options: { expression: "1 / z" } },
          ],
        },
        count: 3,
      },
    });
    expect(warn.json().warnings).toBe(3);
  });
});
```

`apps/server/test/generate.test.ts`:
```ts
import AdmZip from "adm-zip";
import { describe, expect, test } from "vitest";
import { createSchema, customersInput, makeApp, ordersInput } from "./helpers.ts";

describe("GET /api/schemas/:id/generate", () => {
  test("streams CSV with download headers", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const r = await app.inject({ method: "GET", url: `/api/schemas/${c.id}/generate?format=csv&count=3` });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toBe('attachment; filename="customers.csv"');
    const lines = r.body.trimEnd().split("\r\n");
    expect(lines[0]).toBe("id,first_name,country");
    expect(lines).toHaveLength(4);
  });

  test("defaults to json with defaultCount rows; same seed is stable", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const a = await app.inject({ method: "GET", url: `/api/schemas/${c.id}/generate` });
    const b = await app.inject({ method: "GET", url: `/api/schemas/${c.id}/generate` });
    expect(a.json()).toHaveLength(5);
    expect(a.body).toBe(b.body);
    const other = await app.inject({ method: "GET", url: `/api/schemas/${c.id}/generate?seed=99` });
    expect(other.body).not.toBe(a.body);
  });

  test("sql with dialect and ddl", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const r = await app.inject({ method: "GET", url: `/api/schemas/${c.id}/generate?format=sql&dialect=mssql&ddl=true&count=2` });
    expect(r.body).toContain("IF OBJECT_ID(N'customers', N'U') IS NULL");
    expect(r.body).toContain("INSERT INTO [customers]");
  });

  test("bad parameters are 400", async () => {
    const app = await makeApp({ maxRows: 10 });
    const c = await createSchema(app, customersInput);
    for (const q of ["format=xml", "dialect=oracle", "count=11", "count=-1", "count=abc", "seed=x"]) {
      const r = await app.inject({ method: "GET", url: `/api/schemas/${c.id}/generate?${q}` });
      expect(r.statusCode, q).toBe(400);
    }
  });
});

describe("POST /api/generate", () => {
  test("sql: one script, parents first", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const o = await createSchema(app, ordersInput(c.id));
    const r = await app.inject({ method: "POST", url: "/api/generate", payload: { schemaIds: [o.id], format: "sql", dialect: "pg" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="mockgen.sql"');
    expect(r.body.indexOf('INSERT INTO "customers"')).toBeLessThan(r.body.indexOf('INSERT INTO "orders"'));
  });

  test("json: zip with one file per schema, referential integrity holds", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const o = await createSchema(app, ordersInput(c.id));
    const r = await app.inject({ method: "POST", url: "/api/generate", payload: { schemaIds: [o.id], format: "json" } });
    expect(r.headers["content-type"]).toBe("application/zip");
    const zip = new AdmZip(r.rawPayload);
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(["customers.json", "orders.json"]);
    const customers = JSON.parse(zip.readAsText("customers.json")) as { id: number }[];
    const orders = JSON.parse(zip.readAsText("orders.json")) as { customer_id: number }[];
    const ids = new Set(customers.map((x) => x.id));
    expect(orders.every((x) => ids.has(x.customer_id))).toBe(true);
  });

  test("count override on referenced schema is 400", async () => {
    const app = await makeApp();
    const c = await createSchema(app, customersInput);
    const o = await createSchema(app, ordersInput(c.id));
    const r = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { schemaIds: [o.id, c.id], counts: { [c.id]: 99 }, format: "sql" },
    });
    expect(r.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mockgen/server test export-plan preview generate`
Expected: FAIL (module not found / 404).

- [ ] **Step 3: Implement the export plan**

`apps/server/src/export-plan.ts`:
```ts
import { referencedSchemaIds, withDependencies, type Schema } from "@mockgen/core";
import { HttpError } from "./errors.ts";

export interface ExportItem {
  schema: Schema;
  count: number;
}

export function resolveExport(
  all: Schema[],
  requested: { id: string; count?: number }[],
  opts: { maxRows: number; seed?: number },
): { items: ExportItem[]; seed: number } {
  if (!requested.length) throw new HttpError(400, "Choose at least one schema");
  let ids: string[];
  try {
    ids = withDependencies(all, requested.map((r) => r.id));
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  const referenced = new Set(ids.flatMap((id) => referencedSchemaIds(byId.get(id)!)));
  const items = ids.map((id) => {
    const schema = byId.get(id)!;
    const explicit = requested.find((r) => r.id === id)?.count;
    if (explicit !== undefined && referenced.has(id) && explicit !== schema.defaultCount) {
      throw new HttpError(
        400,
        `Schema "${schema.slug}" is referenced by another schema, so its count must equal its defaultCount (${schema.defaultCount})`,
      );
    }
    const count = explicit ?? schema.defaultCount;
    if (!Number.isInteger(count) || count < 0 || count > opts.maxRows) {
      throw new HttpError(400, `Count for "${schema.slug}" must be an integer between 0 and ${opts.maxRows}`);
    }
    return { schema, count };
  });
  return { items, seed: opts.seed ?? byId.get(requested[0]!.id)!.seed };
}
```

- [ ] **Step 4: Implement preview**

`apps/server/src/routes/preview.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { DataGenerator, validateSchema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { ValidationFailed } from "../errors.ts";

const PREVIEW_ID = "__preview__";
const MAX_PREVIEW = 100;

export function previewRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: { schema?: Record<string, unknown>; count?: number } }>("/api/preview", async (req) => {
    const input = req.body?.schema ?? {};
    const others = ctx.schemas.all();
    const { schema, issues } = validateSchema({ ...input, id: input.id ?? PREVIEW_ID }, others);
    if (!schema) throw new ValidationFailed(issues);
    const count = Math.max(1, Math.min(Number(req.body?.count ?? 10) || 10, MAX_PREVIEW));
    const gen = new DataGenerator([...others.filter((s) => s.id !== schema.id), schema]);
    const rows = [...gen.rows(schema.id, Math.min(count, schema.defaultCount), schema.seed)];
    return { rows, warnings: gen.warnings };
  });
}
```

Preview never shows more than `defaultCount` rows, so a 5-row schema previews 5 rows.

- [ ] **Step 5: Implement generate**

`apps/server/src/routes/generate.ts`:
```ts
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import yazl from "yazl";
import { DIALECTS, DataGenerator, FORMATS, FORMAT_MIME, formatRows, type Dialect, type Format } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { HttpError } from "../errors.ts";
import { resolveExport, type ExportItem } from "../export-plan.ts";
import { requireSchema } from "./schemas.ts";

export function parseFormat(v: unknown): Format {
  const f = v ?? "json";
  if (!FORMATS.includes(f as Format)) throw new HttpError(400, `format must be one of ${FORMATS.join(", ")}`);
  return f as Format;
}

export function parseDialect(v: unknown): Dialect {
  const d = v ?? "pg";
  if (!DIALECTS.includes(d as Dialect)) throw new HttpError(400, `dialect must be one of ${DIALECTS.join(", ")}`);
  return d as Dialect;
}

export function parseCount(v: unknown, fallback: number, maxRows: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > maxRows) throw new HttpError(400, `count must be an integer between 0 and ${maxRows}`);
  return n;
}

function parseSeed(v: unknown, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 31 - 1) throw new HttpError(400, "seed must be a non-negative integer");
  return n;
}

const truthy = (v: unknown) => v === true || v === "true" || v === "1";

function attachment(reply: FastifyReply, mime: string, filename: string) {
  return reply.type(mime).header("content-disposition", `attachment; filename="${filename}"`);
}

function stream(chunks: Iterable<string>, gen: DataGenerator, app: FastifyInstance, label: string): Readable {
  const s = Readable.from(chunks);
  s.on("end", () => {
    if (gen.warnings) app.log.warn({ label, warnings: gen.warnings }, "formula warnings during generation");
  });
  return s;
}

function* concat(parts: Iterable<string>[]): Generator<string> {
  for (const p of parts) yield* p;
}

export function generateRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    "/api/schemas/:id/generate",
    async (req, reply) => {
      const schema = requireSchema(ctx, req.params.id);
      const q = req.query;
      const format = parseFormat(q.format);
      const dialect = parseDialect(q.dialect);
      const count = parseCount(q.count, schema.defaultCount, ctx.config.maxRows);
      const seed = parseSeed(q.seed, schema.seed);
      const all = ctx.schemas.all();
      const gen = new DataGenerator(all);
      const chunks = formatRows(format, schema, all, gen.rows(schema.id, count, seed), { dialect, ddl: truthy(q.ddl) });
      return attachment(reply, FORMAT_MIME[format], `${schema.slug}.${format}`).send(stream(chunks, gen, app, schema.slug));
    },
  );

  app.post<{
    Body: { schemaIds?: string[]; counts?: Record<string, number>; format?: string; dialect?: string; seed?: number; ddl?: boolean };
  }>("/api/generate", async (req, reply) => {
    const body = req.body ?? {};
    const format = parseFormat(body.format);
    const dialect = parseDialect(body.dialect);
    const all = ctx.schemas.all();
    const requested = (body.schemaIds ?? []).map((id) => ({ id, count: body.counts?.[id] }));
    const { items, seed } = resolveExport(all, requested, {
      maxRows: ctx.config.maxRows,
      seed: body.seed === undefined ? undefined : parseSeed(body.seed, 0),
    });
    const gen = new DataGenerator(all);
    const fileFor = (item: ExportItem) =>
      formatRows(format, item.schema, all, gen.rows(item.schema.id, item.count, seed), { dialect, ddl: body.ddl === true });

    if (format === "sql") {
      const chunks = concat(items.map((i) => fileFor(i)));
      return attachment(reply, FORMAT_MIME.sql, "mockgen.sql").send(stream(chunks, gen, app, "mockgen.sql"));
    }

    const zip = new yazl.ZipFile();
    for (const item of items) zip.addReadStream(Readable.from(fileFor(item)), `${item.schema.slug}.${format}`);
    zip.end();
    return attachment(reply, "application/zip", "mockgen.zip").send(zip.outputStream);
  });
}
```

- [ ] **Step 6: Register the routes**

In `apps/server/src/app.ts` add imports and registrations after `schemaRoutes(app, ctx);`:
```ts
import { previewRoutes } from "./routes/preview.ts";
import { generateRoutes } from "./routes/generate.ts";
// ...
  previewRoutes(app, ctx);
  generateRoutes(app, ctx);
```

- [ ] **Step 7: Run tests and type check**

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): preview and streamed file generation with multi-schema export"
```

---

### Task 4: Mock API

**Files:**
- Create: `apps/server/src/routes/mock.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/mock.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `HttpError` (Task 1); from core: `DataGenerator`, `Schema`, `Row`.
- Produces: routes under `/mock/:slug` as specified in the Global Constraints and spec §5.3:
  - `GET /mock/:slug?page&pageSize&<field>=<value>` → `{ data: Row[]; page: number; pageSize: number; total: number }`
  - `GET /mock/:slug/:id` → `Row` | 404
  - `POST /mock/:slug` → 201 `{ ...body, id: start + defaultCount }`
  - `PUT|PATCH /mock/:slug/:id` → 200 `{ ...row, ...body, id }`
  - `DELETE /mock/:slug/:id` → 204

- [ ] **Step 1: Write the failing test**

`apps/server/test/mock.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { createSchema, customersInput, makeApp } from "./helpers.ts";

async function setup(over: Record<string, unknown> = {}, config = {}) {
  const app = await makeApp(config);
  const c = await createSchema(app, { ...customersInput, defaultCount: 45, ...over });
  return { app, c };
}

describe("mock API", () => {
  test("list pages through defaultCount rows", async () => {
    const { app } = await setup();
    const r = await app.inject({ method: "GET", url: "/mock/customers?page=3&pageSize=20" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ page: 3, pageSize: 20, total: 45 });
    expect(body.data.map((x: { id: number }) => x.id)).toEqual([41, 42, 43, 44, 45]);
  });

  test("data is stable between calls", async () => {
    const { app } = await setup();
    const a = await app.inject({ method: "GET", url: "/mock/customers" });
    const b = await app.inject({ method: "GET", url: "/mock/customers" });
    expect(a.body).toBe(b.body);
    expect(a.json().data).toHaveLength(20);
  });

  test("by id matches list row", async () => {
    const { app } = await setup();
    const list = (await app.inject({ method: "GET", url: "/mock/customers?pageSize=10" })).json().data;
    const one = await app.inject({ method: "GET", url: "/mock/customers/7" });
    expect(one.json()).toEqual(list[6]);
    expect((await app.inject({ method: "GET", url: "/mock/customers/46" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/mock/customers/0" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/mock/customers/abc" })).statusCode).toBe(404);
  });

  test("equality filters", async () => {
    const { app } = await setup();
    const r = (await app.inject({ method: "GET", url: "/mock/customers?country=DK&pageSize=1000" })).json();
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThan(45);
    expect(r.data.every((x: { country: string }) => x.country === "DK")).toBe(true);
    const bad = await app.inject({ method: "GET", url: "/mock/customers?nope=1" });
    expect(bad.statusCode).toBe(400);
  });

  test("filters scan at most MOCK_SCAN_LIMIT rows", async () => {
    const { app } = await setup({}, { mockScanLimit: 10 });
    const r = (await app.inject({ method: "GET", url: "/mock/customers?country=DK&pageSize=1000" })).json();
    expect(r.total).toBeLessThanOrEqual(10);
  });

  test("writes echo and store nothing", async () => {
    const { app } = await setup();
    const before = (await app.inject({ method: "GET", url: "/mock/customers/3" })).json();
    const post = await app.inject({ method: "POST", url: "/mock/customers", payload: { first_name: "Zed" } });
    expect(post.statusCode).toBe(201);
    expect(post.json()).toEqual({ first_name: "Zed", id: 46 });
    const put = await app.inject({ method: "PUT", url: "/mock/customers/3", payload: { first_name: "Zed", id: 999 } });
    expect(put.json()).toEqual({ ...before, first_name: "Zed", id: 3 });
    expect((await app.inject({ method: "PATCH", url: "/mock/customers/3", payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/mock/customers/3" })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/mock/customers/99" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/mock/customers/3" })).json()).toEqual(before);
  });

  test("disabled or unknown slug is 404; schema without rowNumber id has no by-id", async () => {
    const { app } = await setup({ mockEnabled: false });
    expect((await app.inject({ method: "GET", url: "/mock/customers" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/mock/nope" })).statusCode).toBe(404);

    const app2 = await makeApp();
    await createSchema(app2, { ...customersInput, fields: [{ name: "id", type: "uuid" }] });
    const r = await app2.inject({ method: "GET", url: "/mock/customers/1" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toContain("rowNumber");
  });

  test("bad paging is 400", async () => {
    const { app } = await setup();
    for (const q of ["page=0", "pageSize=0", "pageSize=1001", "page=x"]) {
      expect((await app.inject({ method: "GET", url: `/mock/customers?${q}` })).statusCode, q).toBe(400);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/server test mock`
Expected: FAIL with 404 for the list route.

- [ ] **Step 3: Implement the mock routes**

`apps/server/src/routes/mock.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { DataGenerator, type Row, type Schema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { HttpError } from "../errors.ts";

const MAX_PAGE_SIZE = 1000;

function intParam(v: string | undefined, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `${name} must be an integer between 1 and ${max}`);
  return n;
}

function idStart(schema: Schema): number {
  const field = schema.fields.find((f) => f.name === "id" && f.type === "rowNumber");
  if (!field) throw new HttpError(404, `Schema "${schema.slug}" needs a top-level "id" field of type rowNumber for by-id requests`);
  return typeof field.options.start === "number" ? field.options.start : 1;
}

function bodyObject(body: unknown): Row {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Body must be a JSON object");
  return body as Row;
}

export function mockRoutes(app: FastifyInstance, ctx: AppContext) {
  const mockSchema = (slug: string): Schema => {
    const schema = ctx.schemas.getBySlug(slug);
    if (!schema || !schema.mockEnabled) throw new HttpError(404, `No mock endpoint for "${slug}"`);
    return schema;
  };

  const rowById = (schema: Schema, rawId: string): { row: Row; id: number } => {
    const start = idStart(schema);
    const id = Number(rawId);
    const index = id - start;
    if (!Number.isInteger(id) || index < 0 || index >= schema.defaultCount) throw new HttpError(404, "Not found");
    const row = new DataGenerator(ctx.schemas.all()).row(schema.id, index, schema.seed);
    return { row, id };
  };

  app.get<{ Params: { slug: string }; Querystring: Record<string, string | undefined> }>("/mock/:slug", async (req) => {
    const schema = mockSchema(req.params.slug);
    const { page: rawPage, pageSize: rawSize, ...filters } = req.query;
    const page = intParam(rawPage, "page", 1);
    const pageSize = intParam(rawSize, "pageSize", 20, MAX_PAGE_SIZE);
    const gen = new DataGenerator(ctx.schemas.all());
    const offset = (page - 1) * pageSize;

    const keys = Object.keys(filters);
    if (!keys.length) {
      const end = Math.min(offset + pageSize, schema.defaultCount);
      const data: Row[] = [];
      for (let i = offset; i < end; i++) data.push(gen.row(schema.id, i, schema.seed));
      return { data, page, pageSize, total: schema.defaultCount };
    }

    const topLevel = new Set(schema.fields.map((f) => f.name));
    const unknown = keys.filter((k) => !topLevel.has(k));
    if (unknown.length) throw new HttpError(400, `Unknown filter field: ${unknown.join(", ")}`);
    const matches: Row[] = [];
    const scan = Math.min(schema.defaultCount, ctx.config.mockScanLimit);
    for (const row of gen.rows(schema.id, scan, schema.seed)) {
      if (keys.every((k) => String(row[k]) === filters[k])) matches.push(row);
    }
    return { data: matches.slice(offset, offset + pageSize), page, pageSize, total: matches.length };
  });

  app.get<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", async (req) => {
    return rowById(mockSchema(req.params.slug), req.params.id).row;
  });

  app.post<{ Params: { slug: string } }>("/mock/:slug", async (req, reply) => {
    const schema = mockSchema(req.params.slug);
    const body = bodyObject(req.body);
    return reply.status(201).send({ ...body, id: idStart(schema) + schema.defaultCount });
  });

  const update = async (req: { params: { slug: string; id: string }; body: unknown }) => {
    const { row, id } = rowById(mockSchema(req.params.slug), req.params.id);
    return { ...row, ...bodyObject(req.body), id };
  };
  app.put<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", update);
  app.patch<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", update);

  app.delete<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", async (req, reply) => {
    rowById(mockSchema(req.params.slug), req.params.id);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 4: Register and run**

In `apps/server/src/app.ts` add `import { mockRoutes } from "./routes/mock.ts";` and `mockRoutes(app, ctx);` after `generateRoutes(app, ctx);`.

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): stable read-only mock API"
```

---

### Task 5: OpenAPI docs, web UI hosting and process entry

**Files:**
- Create: `apps/server/src/routes/docs.ts`, `apps/server/src/routes/web.ts`, `apps/server/src/main.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/docs-web.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `Config` (Task 1).
- Produces: `docsRoutes(app): Promise<void>` (must be registered before other routes so they appear in the spec); `webRoutes(app, ctx): Promise<void>`; `GET /docs` (Swagger UI), `GET /docs/json` (OpenAPI document); static UI at `/` when `config.webDir` is set; JSON 404 `{ error: "Not found" }` for unknown `/api`, `/mock`, `/docs` paths; `index.html` fallback for other paths.

- [ ] **Step 1: Write the failing test**

`apps/server/test/docs-web.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

describe("docs", () => {
  test("serves the OpenAPI document with our routes", async () => {
    const app = await makeApp();
    await app.ready();
    const r = await app.inject({ method: "GET", url: "/docs/json" });
    expect(r.statusCode).toBe(200);
    const doc = r.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/schemas", "/api/generate", "/mock/{slug}"]));
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBeLessThan(400);
  });
});

describe("web hosting", () => {
  test("serves index.html and falls back for client routes; API 404 stays JSON", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-web-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>mockgen</title>");
    const app = await makeApp({ webDir: dir });
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain("<title>mockgen</title>");
    expect((await app.inject({ method: "GET", url: "/connections" })).body).toContain("<title>mockgen</title>");
    const api404 = await app.inject({ method: "GET", url: "/api/nope" });
    expect(api404.statusCode).toBe(404);
    expect(api404.json()).toEqual({ error: "Not found" });
  });

  test("without a web dir, unknown paths are JSON 404", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "Not found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mockgen/server test docs-web`
Expected: FAIL (404 on `/docs/json`; HTML not served).

- [ ] **Step 3: Implement docs and web routes**

`apps/server/src/routes/docs.ts`:
```ts
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function docsRoutes(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "mockgen",
        description: "Mock data generator: schemas, file generation, mock REST endpoints and database seeding.",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}
```

`apps/server/src/routes/web.ts`:
```ts
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppContext } from "../app.ts";

const API_PREFIXES = ["/api", "/mock", "/docs", "/health"];

export async function webRoutes(app: FastifyInstance, ctx: AppContext) {
  const webDir = ctx.config.webDir;
  if (webDir) await app.register(fastifyStatic, { root: webDir, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`) || req.url.startsWith(`${p}?`));
    if (webDir && !isApi && req.method === "GET") return reply.sendFile("index.html");
    return reply.status(404).send({ error: "Not found" });
  });
}
```

- [ ] **Step 4: Wire into the app**

Replace `apps/server/src/app.ts` with:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { errorHandler } from "./errors.ts";
import { SchemaRepo } from "./repo/schemas.ts";
import { docsRoutes } from "./routes/docs.ts";
import { generateRoutes } from "./routes/generate.ts";
import { healthRoutes } from "./routes/health.ts";
import { mockRoutes } from "./routes/mock.ts";
import { previewRoutes } from "./routes/preview.ts";
import { schemaRoutes } from "./routes/schemas.ts";
import { typeRoutes } from "./routes/types.ts";
import { webRoutes } from "./routes/web.ts";

export interface AppContext {
  config: Config;
  db: Db;
  schemas: SchemaRepo;
}

export async function buildApp(opts: { config: Config; db: Db; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });
  const ctx: AppContext = { config: opts.config, db: opts.db, schemas: new SchemaRepo(opts.db) };
  app.setErrorHandler(errorHandler);
  await docsRoutes(app);
  healthRoutes(app);
  typeRoutes(app);
  schemaRoutes(app, ctx);
  previewRoutes(app, ctx);
  generateRoutes(app, ctx);
  mockRoutes(app, ctx);
  await webRoutes(app, ctx);
  return app;
}
```

- [ ] **Step 5: Implement the entry point**

`apps/server/src/main.ts`:
```ts
import path from "node:path";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";

const config = loadConfig();
const db = openDb(path.join(config.dataDir, "mockgen.db"));
const app = await buildApp({ config, db });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
if (!config.webDir) app.log.warn("Web UI not found; build apps/web or set WEB_DIR. API is available.");
```

- [ ] **Step 6: Run tests, type check, and a manual smoke run**

Run: `pnpm --filter @mockgen/server test && pnpm --filter @mockgen/server typecheck`
Expected: PASS; exit 0.

Run (Git Bash): `DATA_DIR=./data PORT=8089 node --disable-warning=ExperimentalWarning apps/server/src/main.ts` (run in the background), then `curl -s http://localhost:8089/health`
Expected: `{"status":"ok"}`. Stop the server afterwards. `data/` is git-ignored.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): OpenAPI docs, web UI hosting and entry point"
```
