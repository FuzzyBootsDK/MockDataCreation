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
