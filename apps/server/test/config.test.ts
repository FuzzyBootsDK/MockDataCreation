import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  test("defaults", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ port: 8080, host: "0.0.0.0", dataDir: "/data", maxRows: 1_000_000, mockScanLimit: 10_000 });
  });

  test("reads env", () => {
    const c = loadConfig({ PORT: "9000", DATA_DIR: "./d", MAX_ROWS: "50", MOCK_SCAN_LIMIT: "7", WEB_DIR: "/nope" });
    expect(c.port).toBe(9000);
    expect(c.dataDir).toBe(path.resolve("./d"));
    expect(c.maxRows).toBe(50);
    expect(c.mockScanLimit).toBe(7);
    expect(c.webDir).toBeNull(); // missing directory is ignored
  });

  test("parses ALLOWED_HOSTS", () => {
    expect(loadConfig({}).allowedHosts).toEqual([]);
    expect(loadConfig({ ALLOWED_HOSTS: " Mockgen.LAN, ,box.example " }).allowedHosts).toEqual(["mockgen.lan", "box.example"]);
  });

  test("rejects invalid numbers", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow("PORT");
    expect(() => loadConfig({ MAX_ROWS: "0" })).toThrow("MAX_ROWS");
  });
});
