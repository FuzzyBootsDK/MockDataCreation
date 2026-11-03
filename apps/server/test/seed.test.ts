import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { describe, expect, test } from "vitest";
import { createSchema, customersInput, makeApp, ordersInput } from "./helpers.ts";

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-seed-"));
  const app = await makeApp({ dataDir, maxRows: 5000 });
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
