import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveSecret } from "../src/connections/model.ts";
import { makeApp } from "./helpers.ts";

const sqliteConn = { name: "Local", kind: "sqlite", file: "seed-test.db" };

describe("resolveSecret", () => {
  test("plain values pass through, ${VAR} resolves, missing var throws", () => {
    expect(resolveSecret("secret", {})).toBe("secret");
    expect(resolveSecret("${MOCKGEN_SECRET_PG_PW}", { MOCKGEN_SECRET_PG_PW: "x" })).toBe("x");
    expect(resolveSecret("pre${MOCKGEN_SECRET_PG_PW}", { MOCKGEN_SECRET_PG_PW: "x" })).toBe("pre${MOCKGEN_SECRET_PG_PW}");
    expect(() => resolveSecret("${MOCKGEN_SECRET_NOPE}", {})).toThrow("Environment variable MOCKGEN_SECRET_NOPE is not set");
  });

  test("only MOCKGEN_SECRET_* variables can be referenced", () => {
    expect(() => resolveSecret("${PATH}", { PATH: "/bin" })).toThrow(
      "Only environment variables starting with MOCKGEN_SECRET_ can be referenced",
    );
  });
});

describe("/api/connections", () => {
  test("CRUD with defaults per kind", async () => {
    const app = await makeApp();
    const pg = await app.inject({
      method: "POST",
      url: "/api/connections",
      payload: { name: "PG", kind: "pg", host: "localhost", database: "db", user: "u" },
    });
    expect(pg.statusCode).toBe(201);
    expect(pg.json()).toMatchObject({ kind: "pg", port: 5432, password: "", ssl: false });
    const id = pg.json().id as string;

    const upd = await app.inject({ method: "PUT", url: `/api/connections/${id}`, payload: { ...(pg.json() as object), name: "Renamed" } });
    expect(upd.json()).toMatchObject({ id, name: "Renamed" });

    expect((await app.inject({ method: "GET", url: "/api/connections" })).json()).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/connections/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/connections/${id}` })).statusCode).toBe(404);
  });

  test("validation errors", async () => {
    const app = await makeApp();
    const r = await app.inject({ method: "POST", url: "/api/connections", payload: { name: "X", kind: "pg", host: "" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["host", "database", "user"]));
    const bad = await app.inject({ method: "POST", url: "/api/connections", payload: { name: "X", kind: "oracle" } });
    expect(bad.statusCode).toBe(400);
  });

  test("test endpoint succeeds for sqlite and reports failures", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-conn-"));
    const app = await makeApp({ dataDir });
    const ok = await app.inject({ method: "POST", url: "/api/connections", payload: sqliteConn });
    const t = await app.inject({ method: "POST", url: `/api/connections/${ok.json().id}/test` });
    expect(t.json()).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dataDir, "seed-test.db"))).toBe(true);

    const pg = await app.inject({
      method: "POST",
      url: "/api/connections",
      payload: { name: "Down", kind: "pg", host: "127.0.0.1", port: 1, database: "x", user: "x" },
    });
    const fail = await app.inject({ method: "POST", url: `/api/connections/${pg.json().id}/test` });
    expect(fail.json().ok).toBe(false);
    expect(fail.json().error).toEqual(expect.any(String));
  });

  test("refuses mockgen's own database", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-conn-"));
    const app = await makeApp({ dataDir });
    const c = await app.inject({ method: "POST", url: "/api/connections", payload: { ...sqliteConn, file: "mockgen.db" } });
    const t = await app.inject({ method: "POST", url: `/api/connections/${c.json().id}/test` });
    expect(t.json()).toEqual({ ok: false, error: "Cannot seed into mockgen's own database" });
  });

  test("sqlite files must stay inside the data directory", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-conn-"));
    const app = await makeApp({ dataDir });
    const run = async (file: string) => {
      const c = await app.inject({ method: "POST", url: "/api/connections", payload: { ...sqliteConn, file } });
      return (await app.inject({ method: "POST", url: `/api/connections/${c.json().id}/test` })).json();
    };
    const msg = { ok: false, error: "SQLite file must be inside the data directory" };
    expect(await run("../escape.db")).toEqual(msg);
    expect(await run(path.join(os.tmpdir(), "x.db"))).toEqual(msg);
    expect(await run("sub/dir/ok.db")).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dataDir, "sub", "dir", "ok.db"))).toBe(true);
  });

  test("refuses mockgen.db case variants and sidecar files", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockgen-conn-"));
    const app = await makeApp({ dataDir });
    for (const file of ["MockGen.DB", "mockgen.db-wal"]) {
      const c = await app.inject({ method: "POST", url: "/api/connections", payload: { ...sqliteConn, file } });
      const t = await app.inject({ method: "POST", url: `/api/connections/${c.json().id}/test` });
      expect(t.json()).toEqual({ ok: false, error: "Cannot seed into mockgen's own database" });
    }
  });
});
