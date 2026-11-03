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
