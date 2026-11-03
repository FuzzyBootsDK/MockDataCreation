import { expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

test("GET /health", async () => {
  const app = await makeApp();
  const r = await app.inject({ method: "GET", url: "/health" });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ status: "ok" });
});
