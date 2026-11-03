import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sql from "mssql";
import pg from "pg";
import type { Dialect } from "@mockgen/core";
import { resolveSecret, type Connection } from "../connections/model.ts";
import { HttpError } from "../errors.ts";

export interface SeedTarget {
  dialect: Dialect;
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

export async function openTarget(
  conn: Connection,
  opts: { dataDir: string; env: NodeJS.ProcessEnv },
): Promise<SeedTarget> {
  switch (conn.kind) {
    case "sqlite":
      return openSqlite(conn.file, opts.dataDir);
    case "pg":
      return openPg(conn, resolveSecret(conn.password, opts.env));
    case "mssql":
      return openMssql(conn, resolveSecret(conn.password, opts.env));
  }
}

function openSqlite(file: string, dataDir: string): SeedTarget {
  const root = path.resolve(dataDir);
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep)) throw new HttpError(400, "SQLite file must be inside the data directory");
  if (path.basename(resolved).toLowerCase().startsWith("mockgen.db")) throw new HttpError(400, "Cannot seed into mockgen's own database");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  return {
    dialect: "sqlite",
    exec: async (text) => void db.exec(text),
    begin: async () => void db.exec("BEGIN"),
    commit: async () => void db.exec("COMMIT"),
    rollback: async () => void db.exec("ROLLBACK"),
    close: async () => void db.close(),
  };
}

async function openPg(conn: Extract<Connection, { kind: "pg" }>, password: string): Promise<SeedTarget> {
  const client = new pg.Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password,
    ssl: conn.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });
  let lost: Error | null = null;
  client.on("error", (e) => {
    lost = e;
  });
  await client.connect();
  const query = async (text: string) => {
    if (lost) throw new Error(`Connection lost: ${lost.message}`);
    await client.query(text);
  };
  return {
    dialect: "pg",
    exec: query,
    begin: () => query("BEGIN"),
    commit: () => query("COMMIT"),
    rollback: () => query("ROLLBACK"),
    close: () => client.end(),
  };
}

async function openMssql(conn: Extract<Connection, { kind: "mssql" }>, password: string): Promise<SeedTarget> {
  const pool = new sql.ConnectionPool({
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password,
    connectionTimeout: 10_000,
    requestTimeout: 120_000,
    options: { encrypt: conn.encrypt, trustServerCertificate: conn.trustServerCertificate },
  });
  let lost: Error | null = null;
  pool.on("error", (e) => {
    lost = e;
  });
  await pool.connect();
  const check = () => {
    if (lost) throw new Error(`Connection lost: ${lost.message}`);
  };
  let tx: sql.Transaction | null = null;
  return {
    dialect: "mssql",
    exec: async (text) => {
      check();
      await (tx ? new sql.Request(tx) : pool.request()).batch(text);
    },
    begin: async () => {
      check();
      if (tx) throw new Error("Transaction already open");
      const t = new sql.Transaction(pool);
      await t.begin();
      tx = t;
    },
    commit: async () => {
      check();
      const t = tx;
      try {
        await t?.commit();
      } finally {
        tx = null;
      }
    },
    rollback: async () => {
      const t = tx;
      tx = null;
      try {
        await t?.rollback();
      } catch {
        // keep the caller's original error
      }
    },
    close: () => pool.close(),
  };
}
