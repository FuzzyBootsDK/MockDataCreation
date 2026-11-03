import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
  let webDir: string;

  beforeAll(() => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-web-"));
    fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>mockgen</title>");
  });

  afterAll(() => {
    fs.rmSync(webDir, { recursive: true, force: true });
  });

  test("serves index.html and falls back for client routes; API 404 stays JSON", async () => {
    const app = await makeApp({ webDir });
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain("<title>mockgen</title>");
    expect((await app.inject({ method: "GET", url: "/connections" })).body).toContain("<title>mockgen</title>");
    const api404 = await app.inject({ method: "GET", url: "/api/nope" });
    expect(api404.statusCode).toBe(404);
    expect(api404.json()).toEqual({ error: "Not found" });
  });

  test.each([
    "//api/nope",
    "/API/nope",
    "/api%2Fnope",
    "/docs/nope",
    "/health/nope",
    "/assets/missing.js",
  ])("unknown API-like or asset path %s is JSON 404", async (url) => {
    const app = await makeApp({ webDir });
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "Not found" });
  });

  test("malformed percent-encoding is rejected before the SPA fallback", async () => {
    const app = await makeApp({ webDir });
    const r = await app.inject({ method: "GET", url: "/%ZZ" });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain("<title>mockgen</title>");
  });

  test("mock routes keep their own 404 body and never serve the SPA", async () => {
    const app = await makeApp({ webDir });
    const r = await app.inject({ method: "GET", url: "/mock/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toHaveProperty("error");
    expect(r.body).not.toContain("<title>mockgen</title>");
  });

  test("HEAD falls back to index.html", async () => {
    const app = await makeApp({ webDir });
    const r = await app.inject({ method: "HEAD", url: "/connections" });
    expect(r.statusCode).toBe(200);
  });

  test("query strings do not affect the fallback", async () => {
    const app = await makeApp({ webDir });
    const r = await app.inject({ method: "GET", url: "/connections?x=1" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("<title>mockgen</title>");
  });

  test("without a web dir, unknown paths are JSON 404", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "Not found" });
  });
});
