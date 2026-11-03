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
  const resolved = path.resolve(dataDir, file);
  if (resolved === path.resolve(dataDir, "mockgen.db")) throw new HttpError(400, "Cannot seed into mockgen's own database");
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
  await client.connect();
  return {
    dialect: "pg",
    exec: async (text) => void (await client.query(text)),
    begin: async () => void (await client.query("BEGIN")),
    commit: async () => void (await client.query("COMMIT")),
    rollback: async () => void (await client.query("ROLLBACK")),
    close: () => client.end(),
  };
}

async function openMssql(conn: Extract<Connection, { kind: "mssql" }>, password: string): Promise<SeedTarget> {
  const pool = await new sql.ConnectionPool({
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password,
    connectionTimeout: 10_000,
    requestTimeout: 120_000,
    options: { encrypt: conn.encrypt, trustServerCertificate: conn.trustServerCertificate },
  }).connect();
  let tx: sql.Transaction | null = null;
  return {
    dialect: "mssql",
    exec: async (text) => void (await (tx ? new sql.Request(tx) : pool.request()).batch(text)),
    begin: async () => {
      tx = new sql.Transaction(pool);
      await tx.begin();
    },
    commit: async () => {
      await tx?.commit();
      tx = null;
    },
    rollback: async () => {
      const t = tx;
      tx = null;
      await t?.rollback();
    },
    close: () => pool.close(),
  };
}
