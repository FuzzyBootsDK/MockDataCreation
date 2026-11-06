import os from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { openDb } from "../src/db.ts";

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir: os.tmpdir(),
    maxRows: 1000,
    mockScanLimit: 10_000,
    webDir: null,
    allowedHosts: [],
    // On by default so the existing suite keeps exercising connections and seeding; the tests
    // for a locked-down instance pass dbTargets: false explicitly.
    dbTargets: true,
    ...over,
  };
}

export async function makeApp(over: Partial<Config> = {}): Promise<FastifyInstance> {
  return buildApp({ config: testConfig(over), db: openDb(":memory:"), logger: false });
}

export async function createSchema(app: FastifyInstance, body: unknown): Promise<{ id: string; [k: string]: unknown }> {
  const r = await app.inject({ method: "POST", url: "/api/schemas", payload: body as object });
  if (r.statusCode !== 201) throw new Error(`createSchema failed: ${r.statusCode} ${r.body}`);
  return r.json();
}

export const customersInput = {
  name: "Customers",
  slug: "customers",
  defaultCount: 5,
  seed: 7,
  mockEnabled: true,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "first_name", type: "person.firstName" },
    { name: "country", type: "customList", options: { values: [{ value: "DK" }, { value: "SE" }] } },
  ],
};

export const ordersInput = (customerId: string) => ({
  name: "Orders",
  slug: "orders",
  defaultCount: 20,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "customer_id", type: "reference", options: { schemaId: customerId, fieldName: "id" } },
    { name: "qty", type: "number", options: { min: 1, max: 5 } },
  ],
});
