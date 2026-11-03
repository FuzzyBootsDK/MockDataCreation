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
  expect(body.maxRows).toBe(1000);
});

test("types carry three examples or a description for the type picker", async () => {
  const app = await makeApp();
  const types = (await app.inject({ method: "GET", url: "/api/types" })).json().types as {
    key: string; examples: string[]; description?: string;
  }[];
  const email = types.find((t) => t.key === "internet.email")!;
  expect(email.examples).toHaveLength(3);
  expect(email.examples.every((e) => e.includes("@"))).toBe(true);
  const formula = types.find((t) => t.key === "formula")!;
  expect(formula.examples).toEqual([]);
  expect(formula.description).toMatch(/other fields/);
  expect(types.every((t) => t.examples.length === 3 || t.description)).toBe(true);
  expect(types.every((t) => t.examples.every((e) => e.length <= 60))).toBe(true);
});
