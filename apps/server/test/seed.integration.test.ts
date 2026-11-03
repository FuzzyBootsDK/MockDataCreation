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
  const started = await app.inject({ method: "POST", url: "/api/seed", payload: body });
  expect(started.statusCode, started.body).toBe(202);
  const { jobId } = started.json();
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
    process.env.MOCKGEN_SECRET_IT_PG = container.getPassword();
    const app = await makeApp({ maxRows: 5000 });
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
          database: container.getDatabase(), user: container.getUsername(), password: "${MOCKGEN_SECRET_IT_PG}",
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
    const app = await makeApp({ maxRows: 5000 });
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
