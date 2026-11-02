# mockgen — Design Spec

**Date:** 2026-11-02
**Status:** Approved design, pending implementation plan

## 1. Purpose

A self-hosted, Mockaroo-style mock data generator that runs as a single Docker container on the user's machine. One user, no authentication. It lets the user:

1. Build data schemas in a web UI, preview them, and download files (CSV, JSON, NDJSON, SQL).
2. Generate data programmatically through a REST API.
3. Serve saved schemas as stable, read-only mock REST endpoints.
4. Seed PostgreSQL, SQL Server, or SQLite databases directly.

## 2. Architecture

One Docker image (`mockgen`), one Node.js process listening on port `8080`. Persistent state lives on a volume at `/data` (`/data/mockgen.db`, SQLite).

pnpm monorepo, TypeScript throughout:

| Package | Responsibility | Key dependencies |
|---|---|---|
| `packages/core` | Pure library: schema model (Zod), field-type registry, generator engine, output formatters. No I/O; generators return iterables of rows and string chunks. | `@faker-js/faker`, `jsep`, `zod` |
| `apps/server` | Fastify app: schema persistence, schema CRUD API, generate API, mock API, seeding API, serves the built web UI and OpenAPI docs. | `core`, `fastify`, `better-sqlite3`, `pg`, `mssql`, `archiver` |
| `apps/web` | React + Vite SPA: schema list, schema editor, preview, download, mock and seed dialogs. | `core` (types and type metadata only), `react` |

All four front ends use one core entry point:

```ts
class DataGenerator {
  constructor(schemas: Schema[])
  rows(schemaId: string, count: number, seed: number): Iterable<Row>
  row(schemaId: string, rowIndex: number, seed: number): Row
  warnings: number
}
```

Each front end is an adapter: the UI previews, `/api/generate` formats to a file, `/mock` pages, `/api/seed` batches into INSERTs.

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Location of `mockgen.db` |
| `MAX_ROWS` | `1000000` | Upper bound on `count` for generate and seed |
| `MOCK_SCAN_LIMIT` | `10000` | Max rows scanned for mock equality filters |

`docker-compose.yml` defines the `mockgen` service plus optional `postgres` and `mssql` services (behind a compose profile `dbs`) for trying out seeding.

## 3. Schema model

Stored as JSON in SQLite, validated with Zod on save and on preview.

```ts
Schema {
  id: string            // uuid
  name: string          // display name
  slug: string          // unique, URL-safe; used for /mock/<slug> and SQL table name
  locale: string        // faker locale code, e.g. "en", "da", "de"
  defaultCount: number  // rows used for relations and mock endpoints
  seed: number          // schema seed; default for generation
  mockEnabled: boolean
  fields: Field[]
}

Field {
  name: string          // unique among siblings; [A-Za-z_][A-Za-z0-9_]*
  type: string          // key in the field-type registry
  options: object       // validated by the type's own Zod option schema
  blankPercent: number  // 0–100
  children?: Field[]    // only for object and array types
}
```

A **SchemaSet** is the full collection of saved schemas, needed to resolve `reference` fields.

### Field types

Every type is a registry entry: `{ key, category, label, optionsSchema, sqlType(dialect), generate(ctx) }`. The UI renders option editors from `optionsSchema`.

- **Faker-backed catalog** (~100 curated entries) mapping to faker modules, grouped by category: Person, Internet, Location, Company, Finance, Commerce, Date, Lorem, Phone, Vehicle, etc. Examples: `person.firstName`, `internet.email`, `location.city`, `finance.iban`, `date.between` (options `from`, `to`, `format`).
- **Structural types:**
  - `rowNumber` — 1-based row index (options: `start`, default 1).
  - `uuid` — deterministic from row seed.
  - `number` — `min`, `max`, `decimals`.
  - `boolean` — `truePercent`.
  - `customList` — `values: { value: string; weight: number }[]`.
  - `regex` — `pattern`; generates strings matching the pattern.
  - `formula` — `expression` (see §4.3).
  - `reference` — `schemaId`, `fieldName` (see §4.4).
- **Nesting types:**
  - `object` — `children` fields.
  - `array` — `children` fields, `minItems`, `maxItems`. If exactly one child, items are scalar values; otherwise items are objects.

Max nesting depth: 5.

## 4. Generation engine

### 4.1 Determinism

Each row uses its own PRNG seeded with `hash(seed, schemaId, rowIndex)`. A faker instance for the schema's locale is re-seeded per row. Relative dates (past, future, birthdate) use a fixed reference date of 2026-01-01 so output does not change from day to day. Consequences:

- Same `seed` + same schema → byte-identical output.
- `generateRow(..., rowIndex)` equals row `rowIndex` of the full stream. Used by mock by-id lookups and relations.

### 4.2 Field evaluation order

Within a row (and within each object/array item), non-formula fields are generated first in declaration order. Formula fields are then evaluated in topological order of their references. Circular formula references are rejected at validation time.

### 4.3 Formulas

Parsed with `jsep` and evaluated by mockgen's own whitelisted evaluator (no JavaScript `eval`; `expr-eval` was rejected because it is unmaintained and has open code-execution advisories). Allowed syntax: literals, sibling field names, dotted access to nested values (`address.city`), arithmetic, comparison and logical operators, and calls to the helper functions below. Helper functions:

`concat(...)`, `lower(s)`, `upper(s)`, `trim(s)`, `slug(s)`, `if(cond, a, b)`, `round(n, d)`, `dateAdd(date, amount, unit)`, `coalesce(...)`.

Example: `lower(first_name) + "." + lower(last_name) + "@example.com"`.

A runtime error (e.g. division by zero, type mismatch) yields `null` for that cell and increments a warning counter (reported as described in §5.2). It does not abort generation.

### 4.4 Relations

A `reference` field `{ schemaId, fieldName }` picks `k = rng.int(0, target.defaultCount - 1)` and returns `generateRow(target, k).fieldName`, computing only what's needed for that field. No materialized data is required. Referential integrity holds whenever the target schema is exported or seeded with `count = defaultCount` and the same seed. The multi-schema export and seed APIs use each referenced schema's `defaultCount` and the shared seed unless overridden. A count override on a referenced schema is rejected because it would break integrity.

Reference cycles between schemas (A → B → A) are rejected at validation time.

### 4.5 Blank percent

For each field, the row's PRNG decides up front (before any value is generated) whether the field is blank, with probability `blankPercent / 100`. A blank field's value is `null`. Formulas are evaluated afterwards, so a formula that reads a blank field receives `null`; a formula field can itself have a `blankPercent`.

### 4.6 Output formats

| Format | Nesting | Notes |
|---|---|---|
| `json` | Preserved | Streamed JSON array |
| `ndjson` | Preserved | One object per line |
| `csv` | Objects flattened to `parent_child` columns; arrays as JSON text | RFC 4180 quoting, header row |
| `sql` | Same flattening as CSV | Dialects `pg`, `mssql`, `sqlite`; optional `CREATE TABLE`; multi-row `INSERT` batches of 500 (mssql: 1000-row VALUES limit respected) |

Type → column mapping is defined per field type via `sqlType(dialect)` (e.g. `uuid` → `uuid` / `uniqueidentifier` / `TEXT`).

## 5. Front ends

### 5.1 Web UI

- **Schemas list:** create, duplicate, delete, import/export schema JSON.
- **Schema editor:** field grid (name | type | options | blank % | formula), type picker with search and categories, drag-to-reorder, indented child rows for object/array. Schema-level settings: name, slug, locale, default count, seed.
- **Live preview:** first 10 rows, refreshed 300 ms after the last edit, via `POST /api/preview`. Validation errors shown inline on the offending cell.
- **Download dialog:** count, format, dialect (for SQL), seed, include `CREATE TABLE`; option to include referenced schemas (multi-schema export).
- **Mock tab:** enable/disable toggle, endpoint URL, example `curl` commands.
- **Seed dialog:** connection profile, per-schema counts (referenced schemas locked to `defaultCount`), mode, live progress.
- **Connections page:** CRUD for connection profiles, with a "Test connection" button.

### 5.2 REST API

| Method & path | Purpose |
|---|---|
| `GET/POST /api/schemas`, `GET/PUT/DELETE /api/schemas/:id` | Schema CRUD |
| `GET /api/types` | Field-type registry metadata (for the UI and API users) |
| `POST /api/preview` | Body: unsaved schema (+ SchemaSet context). Returns up to 100 rows or validation errors |
| `GET /api/schemas/:id/generate?format=&dialect=&count=&seed=&ddl=` | Stream a single file |
| `POST /api/generate` | Body `{ schemaIds[], counts?, format, dialect?, seed?, ddl? }`. SQL → one script, parent-first order. CSV/JSON/NDJSON → zip with one file per schema |
| `GET/POST /api/connections`, `PUT/DELETE /api/connections/:id`, `POST /api/connections/:id/test` | Connection profiles |
| `POST /api/seed` | Start seeding; returns a job id |
| `GET /api/seed/:jobId/events` | SSE progress stream |
| `GET /docs` | OpenAPI (Swagger UI) |

File responses set `Content-Disposition` with a filename based on the schema slug. Formula warning counts are returned in `POST /api/preview` responses (`{ rows, warnings }`) and in the seed job's final SSE event; for streamed file downloads they are logged to stdout only, since headers are already sent.

### 5.3 Mock API

Available only for schemas with `mockEnabled = true`. Base path `/mock/<slug>`.

| Request | Behavior |
|---|---|
| `GET /mock/<slug>?page=1&pageSize=20` | `{ data, page, pageSize, total }`, `total = defaultCount`, `pageSize` max 1000 |
| `GET /mock/<slug>?<field>=<value>` | Equality filter on top-level fields; scans up to `MOCK_SCAN_LIMIT` rows; combined with paging |
| `GET /mock/<slug>/:id` | Requires a top-level field named `id` of type `rowNumber`; computes row `id - start`; 404 if out of range |
| `POST /mock/<slug>` | 201, echoes body with `id = defaultCount + 1`; nothing stored |
| `PUT`/`PATCH /mock/<slug>/:id` | 200, echoes generated row merged with body; nothing stored |
| `DELETE /mock/<slug>/:id` | 204; nothing stored |

Data is generated with the schema's stored `seed`, so it is stable across calls and restarts until the schema changes.

### 5.4 Database seeding

- **Connection profiles:** `{ id, name, kind: pg|mssql|sqlite, host, port, database, user, password, options }` (SQLite: file path inside the container, e.g. under `/data`). Stored in the local SQLite database. Passwords are stored in plaintext because this is a single-user local tool; the UI states this. A password may instead be `${ENV_VAR}`, resolved from the container environment at connect time.
- **Request:** `POST /api/seed { connectionId, schemas: [{ id, count? }], mode: "create" | "append" | "truncate", seed? }`.
  - `create`: `CREATE TABLE IF NOT EXISTS` from field types, then insert.
  - `append`: insert into existing tables.
  - `truncate`: delete existing rows (child tables first), then insert.
- **Process:** resolve referenced schemas and add them automatically; order tables parent-first; per schema, one transaction with batched multi-row INSERT statements (500 rows per batch, all three dialects, generated by the same SQL formatter as the SQL export). Progress events: `{ table, inserted, total }`.
- **Failure:** roll back the current schema's transaction; previously completed schemas stay committed. The final SSE event reports the table, batch number, and driver error message.

## 6. Error handling and limits

- **Validation errors** → `400 { errors: [{ path: "fields[3].options.min", message }] }`. Covered: unknown type, invalid options, duplicate/invalid field names, duplicate slug, formula syntax, unknown formula reference, formula cycles, missing reference target, cross-schema reference cycles, nesting deeper than 5, count overrides on referenced schemas.
- **Limits:** `count ≤ MAX_ROWS`; preview ≤ 100 rows; `pageSize ≤ 1000`; nesting depth ≤ 5.
- **Streaming:** generation and seeding are streamed; memory is constant with respect to `count`. Client disconnect aborts generation.
- **Runtime formula errors:** cell becomes `null`, warning counted (see §4.3).
- **Unexpected errors:** `500 { error }` with details logged to stdout.

## 7. Testing

- **`packages/core` (Vitest):** per-type generation and option validation; determinism (same seed → identical bytes; `generateRow(i)` equals row `i` of the stream); formula ordering, helpers, cycle detection; blank % distribution within tolerance; reference integrity across schemas; flattening; formatter golden files per format and SQL dialect.
- **`apps/server` (Vitest + Fastify `inject`):** schema CRUD, preview, generate (single and multi-schema), mock endpoints (paging, filter, by-id, 404, write echo), validation error shapes.
- **Seeding integration:** Testcontainers for PostgreSQL and SQL Server, plus SQLite; all three modes; rollback on failure.
- **`apps/web` (Playwright smoke):** create schema → preview → download file.
- **Container:** `docker compose up` brings the app up on `http://localhost:8080` with a health check at `GET /health`.

## 8. Delivery

- Multi-stage `Dockerfile`: build stage (pnpm install, build core, server, web), runtime stage (Node LTS slim, production deps only, non-root user).
- `docker-compose.yml`: `mockgen` service with a named volume for `/data`; `postgres` and `mssql` services under profile `dbs`.
- `README.md`: run instructions, API overview, formula reference.

## 9. Out of scope

- Authentication, multiple users, sharing.
- Stateful mock endpoints (writes are never persisted).
- MySQL/MariaDB seeding or SQL dialect.
- Danish-specific types (CPR, CVR) beyond what faker's `da` locale provides.
- Scheduled or recurring generation jobs.
