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

  test("POST works without a rowNumber id field", async () => {
    const { app } = await setup({ fields: [{ name: "id", type: "uuid" }, { name: "first_name", type: "person.firstName" }] });
    const post = await app.inject({ method: "POST", url: "/mock/customers", payload: { first_name: "Zed" } });
    expect(post.statusCode).toBe(201);
    expect(post.json()).toEqual({ first_name: "Zed", id: 46 });
  });

  test("mock endpoints send CORS headers, API routes do not", async () => {
    const { app } = await setup();
    const get = await app.inject({ method: "GET", url: "/mock/customers" });
    expect(get.headers["access-control-allow-origin"]).toBe("*");
    const opts = await app.inject({ method: "OPTIONS", url: "/mock/customers" });
    expect(opts.statusCode).toBe(204);
    expect(opts.headers["access-control-allow-origin"]).toBe("*");
    expect(opts.headers["access-control-allow-methods"]).toBe("GET,POST,PUT,PATCH,DELETE");
    expect(opts.headers["access-control-allow-headers"]).toBe("content-type");
    const api = await app.inject({ method: "GET", url: "/api/schemas" });
    expect(api.headers["access-control-allow-origin"]).toBeUndefined();
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
