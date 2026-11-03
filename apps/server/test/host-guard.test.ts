import { describe, expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

const get = async (allowedHosts: string[], host: string) => {
  const app = await makeApp({ allowedHosts });
  return app.inject({ method: "GET", url: "/health", headers: { host } });
};

describe("host guard", () => {
  test("rejects unknown hosts", async () => {
    const r = await get([], "evil.example");
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: "Host not allowed" });
    expect((await get([], "evil.example:8080")).statusCode).toBe(403);
  });

  test("allows loopback hosts with and without port", async () => {
    for (const host of ["localhost:8080", "LOCALHOST", "127.0.0.1:8080", "[::1]:8080", "[::1]"]) {
      expect((await get([], host)).statusCode, host).toBe(200);
    }
  });

  test("allows configured hosts", async () => {
    expect((await get(["mockgen.lan"], "mockgen.lan:8080")).statusCode).toBe(200);
    expect((await get(["mockgen.lan"], "other.lan:8080")).statusCode).toBe(403);
  });
});
