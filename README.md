# mockgen

A self-hosted, Mockaroo-style mock data generator that runs in one Docker container.

- Build schemas in the browser and preview them live
- Download CSV, JSON, NDJSON or SQL (PostgreSQL, SQL Server, SQLite)
- Generate data from scripts through a REST API (`/docs`)
- Serve schemas as stable, read-only mock REST endpoints (`/mock/<slug>`)
- Seed PostgreSQL, SQL Server or SQLite databases directly

## Run it

```bash
docker compose up -d
```

Open http://localhost:8080. Data (schemas and connection profiles) is stored in the `mockgen-data` volume.

To try seeding against local databases too:

```bash
docker compose --profile dbs up -d
```

Then add connections in the UI: host `postgres`, user `mockgen`, database `mockgen`, password `${MOCKGEN_SECRET_PG_PASSWORD}`; or host `mssql`, user `sa`, database `master`, password `${MOCKGEN_SECRET_MSSQL_PASSWORD}`, Encrypt off.

For SQLite, the database file path is relative to the data directory (`DATA_DIR`); files outside it are rejected.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Where `mockgen.db` (and SQLite seed targets) live |
| `MAX_ROWS` | `1000000` | Maximum rows per generate or seed request |
| `MOCK_SCAN_LIMIT` | `10000` | Maximum rows scanned by mock equality filters |
| `ALLOWED_HOSTS` | (empty) | Comma-separated extra hostnames accepted in the `Host` header (`localhost`, `127.0.0.1` and `[::1]` are always allowed) |
| `DB_TARGETS` | `1` | Whether this instance may connect to databases. `0` removes the connection and seed routes and hides them in the UI — see [Running a public instance](#running-a-public-instance) |

## Security

- mockgen has **no authentication**. Anyone who can reach the port can read and change schemas and connection profiles, and can seed the databases those profiles point at.
- `docker-compose.yml` publishes ports on `127.0.0.1` only. To expose mockgen on a network, change the port bindings yourself, put it behind an authenticating proxy, and set `ALLOWED_HOSTS` to the hostnames users will type (requests with any other `Host` header get 403, which blocks DNS rebinding).
- Connection passwords are stored in plain text in the local database and are returned by the API.
- To keep a password out of the database, enter `${MOCKGEN_SECRET_NAME}` as the password and set that environment variable on the container. Only variables starting with `MOCKGEN_SECRET_` can be referenced.

### Running a public instance

`/api/connections` and `/api/seed` are the only routes that reach outside the container: a caller
names any host and port, the server dials it, and seeding writes into whatever answers. On a
private instance that is the point. On one anybody can reach it is an unauthenticated way into
whatever network the container sits on — a visitor can probe for open ports and truncate a table
on a machine they were never meant to see.

So set `DB_TARGETS=0` on any instance that is reachable from the internet:

```yaml
environment:
  DB_TARGETS: "0"
  ALLOWED_HOSTS: "mock.example.com"
```

The connection and seed routes are then never registered — they answer 404, not 403, so a prober
learns nothing — and the UI drops the Connections tab and the *Seed database* button. Everything
else still works: schemas, preview, all export formats and the mock API endpoints.

Two more things worth knowing before you publish one:

- **Schemas are global and unauthenticated.** Any visitor can edit or delete any schema on that
  instance. Give the public instance its own data volume rather than sharing yours.
- **Nothing is rate limited.** `MAX_ROWS` caps one request; it does not cap how many requests
  arrive. Put it behind a proxy that does, if that matters to you.

## Field types

About 225 types, modelled on Mockaroo's list and generated in the schema's locale: personal (names, email address, username, SSN, job title), location, travel (airports, airlines, seats), company, commerce, finance, crypto, IT (IPs and CIDRs, hashes, JWT, MongoDB ObjectID, ULID, app name/version/bundle ID), color, car, nature, food, entertainment, text and dates. Plus:

- **Row Number**, **UUID**, **Number** (range, decimals), **Boolean** (true %), **Custom List** (weighted values), **Regular Expression**
- **Character Sequence**: a pattern where `#` is a digit, `?` a letter and `*` either (e.g. `INV-#####`); **Time** (24h or 12h)
- **Formula**: computed from sibling fields
- **Reference**: picks a value from another schema's rows (foreign keys)
- **Object** and **Array**: nested JSON (flattened to `parent_child` columns in CSV/SQL; arrays become JSON text)

Every field has a **blank %**. Output is deterministic for a given seed. Relative dates (past, future, birthdate) are computed from a fixed reference date, 2026-01-01.

## Formulas

Expressions can use sibling field names (and `object.child` for nested values), literals, `+ - * / %`, comparisons, `&&`, `||`, `!` and these functions:

| Function | Example |
|---|---|
| `concat(a, b, …)` | `concat(first_name, " ", last_name)` |
| `lower(s)`, `upper(s)`, `trim(s)`, `slug(s)` | `lower(first_name) + "@example.com"` |
| `if(cond, a, b)` | `if(age >= 18, "adult", "minor")` |
| `round(n, digits)` | `round(qty * price, 2)` |
| `dateAdd(date, amount, unit)` | `dateAdd(order_date, 3, "days")` (units: years, months, days, hours, minutes) |
| `coalesce(a, b, …)` | `coalesce(nickname, first_name)` |

`+` concatenates when either side is text. Arithmetic with a blank value gives blank. A formula error (such as division by zero) produces a blank value and is counted as a warning in the preview.

## API

Interactive docs: http://localhost:8080/docs. The main endpoints:

```bash
# One schema as a file
curl -o customers.csv "http://localhost:8080/api/schemas/<id>/generate?format=csv&count=1000"

# Several related schemas: one SQL script (parents first) or a zip
curl -o data.sql -X POST http://localhost:8080/api/generate \
  -H "content-type: application/json" \
  -d '{"schemaIds":["<orders-id>"],"format":"sql","dialect":"mssql","ddl":true}'

# Mock endpoints (enable "Serve this schema" first)
curl "http://localhost:8080/mock/customers?page=1&pageSize=20"
curl "http://localhost:8080/mock/customers/1"
curl "http://localhost:8080/mock/customers?country=DK"
```

## Development

Requirements: Node 24+, pnpm 11, Docker (for integration tests).

```bash
pnpm install
pnpm test                                   # unit tests, all packages
pnpm typecheck
pnpm --filter @mockgen/server test:it       # Postgres + SQL Server via Testcontainers
pnpm --filter @mockgen/web e2e              # Playwright smoke test
```

Run locally with hot reload (two terminals):

```bash
DATA_DIR=./data pnpm --filter @mockgen/server dev
pnpm --filter @mockgen/web dev               # http://localhost:5173, proxies the API
```

Layout: `packages/core` (schema model, generator, formats; no I/O), `apps/server` (Fastify API, mock endpoints, seeding), `apps/web` (React UI).
