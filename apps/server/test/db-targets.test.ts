import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createSchema, customersInput, makeApp } from "./helpers.ts";

/**
 * DB_TARGETS=0 is what a publicly reachable mockgen runs with.
 *
 * mockgen has no authentication, and /api/connections and /api/seed are the only routes that
 * reach outside the container: a caller names a host and port, the server dials it, and seeding
 * writes into whatever answers. Private, that is the feature. Public, it is an unauthenticated
 * way into the network the container sits on. These tests are the proof that the flag actually
 * removes that surface rather than merely hiding the buttons.
 */

describe("DB_TARGETS", () => {
  test("defaults on, and parses the usual spellings", () => {
    expect(loadConfig({}).dbTargets).toBe(true);
    expect(loadConfig({ DB_TARGETS: "" }).dbTargets).toBe(true);
    for (const v of ["0", "false", "FALSE", " off ", "no"]) {
      expect(loadConfig({ DB_TARGETS: v }).dbTargets, v).toBe(false);
    }
    for (const v of ["1", "true", "YES", "on"]) {
      expect(loadConfig({ DB_TARGETS: v }).dbTargets, v).toBe(true);
    }
  });

  test("a typo is refused rather than silently defaulting to on", () => {
    // The failure mode worth preventing: DB_TARGETS=flase on the public instance, falling back
    // to the default, leaving database access open with nothing saying so.
    expect(() => loadConfig({ DB_TARGETS: "flase" })).toThrow("DB_TARGETS");
  });

  test("off: every connection and seed route is gone", async () => {
    const app = await makeApp({ dbTargets: false });
    const calls: [string, string][] = [
      ["GET", "/api/connections"],
      ["POST", "/api/connections"],
      ["PUT", "/api/connections/any"],
      ["DELETE", "/api/connections/any"],
      ["POST", "/api/connections/any/test"],
      ["POST", "/api/seed"],
      ["GET", "/api/seed/any"],
    ];
    for (const [method, url] of calls) {
      const r = await app.inject({ method, url, payload: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  test("off: generating data still works — only the database routes go", async () => {
    const app = await makeApp({ dbTargets: false });
    const schema = await createSchema(app, customersInput);
    const r = await app.inject({ method: "GET", url: `/api/schemas/${schema.id}/generate?format=json&count=3` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(3);
  });

  test("/api/types tells the browser which instance it is talking to", async () => {
    const on = await (await makeApp()).inject({ method: "GET", url: "/api/types" });
    expect(on.json().dbTargets).toBe(true);
    const off = await (await makeApp({ dbTargets: false })).inject({ method: "GET", url: "/api/types" });
    expect(off.json().dbTargets).toBe(false);
  });
});
