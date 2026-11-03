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

describe("unnamed drafts", () => {
  test("preview works before the schema has a name or slug", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "POST", url: "/api/preview", payload: { schema: { ...customersInput, name: "", slug: "" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().rows).toHaveLength(5);
  });

  test("a slug that is filled in is still validated", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "POST", url: "/api/preview", payload: { schema: { ...customersInput, slug: "Bad Slug" } } });
    expect(r.statusCode).toBe(400);
    expect(r.json().errors[0].path).toBe("slug");
  });
});
