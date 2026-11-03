import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

describe("docs", () => {
  test("serves the OpenAPI document with our routes", async () => {
    const app = await makeApp();
    await app.ready();
    const r = await app.inject({ method: "GET", url: "/docs/json" });
    expect(r.statusCode).toBe(200);
    const doc = r.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/schemas", "/api/generate", "/mock/{slug}"]));
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBeLessThan(400);
  });
});

describe("web hosting", () => {
  test("serves index.html and falls back for client routes; API 404 stays JSON", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-web-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>mockgen</title>");
    const app = await makeApp({ webDir: dir });
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain("<title>mockgen</title>");
    expect((await app.inject({ method: "GET", url: "/connections" })).body).toContain("<title>mockgen</title>");
    const api404 = await app.inject({ method: "GET", url: "/api/nope" });
    expect(api404.statusCode).toBe(404);
    expect(api404.json()).toEqual({ error: "Not found" });
  });

  test("without a web dir, unknown paths are JSON 404", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "Not found" });
  });
});
