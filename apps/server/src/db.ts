import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const MIGRATIONS = [
  `CREATE TABLE schemas (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE connections (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
];

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  const version = db.pragma("user_version", { simple: true }) as number;
  db.transaction(() => {
    for (let i = version; i < MIGRATIONS.length; i++) db.exec(MIGRATIONS[i]!);
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  })();
  return db;
}
