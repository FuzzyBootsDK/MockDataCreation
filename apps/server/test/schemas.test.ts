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

  test("create keeps a fresh client-supplied UUID but not one already in use", async () => {
    const app = await makeApp();
    const id = "7b0f8f0e-3c1d-4b8e-9a53-0d1f3c2b4a5e";
    const created = await createSchema(app, { ...customersInput, id });
    expect(created.id).toBe(id);
    const again = await createSchema(app, { ...customersInput, slug: "customers-2", id });
    expect(again.id).not.toBe(id);
    expect(again.id).toMatch(/^[0-9a-f-]{36}$/);
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
