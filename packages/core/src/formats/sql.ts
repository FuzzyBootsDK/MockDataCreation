import { columnSql, type Dialect } from "../columns.ts";
import type { Row } from "../model.ts";
import { flattenRow, type Column } from "./flatten.ts";

export const MAX_BATCH = 1000;

export function quoteIdent(name: string, dialect: Dialect): string {
  return dialect === "mssql" ? `[${name.replace(/]/g, "]]")}]` : `"${name.replace(/"/g, '""')}"`;
}

export function sqlLiteral(v: unknown, column: Column, dialect: Dialect): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return dialect === "pg" ? (v ? "TRUE" : "FALSE") : v ? "1" : "0";
  let s = String(v);
  // datetime2 does not accept a trailing Z.
  if (dialect === "mssql" && column.type === "datetime" && s.endsWith("Z")) s = s.slice(0, -1);
  const escaped = s.replace(/'/g, "''");
  return dialect === "mssql" ? `N'${escaped}'` : `'${escaped}'`;
}

export function createTableSql(table: string, columns: Column[], dialect: Dialect): string {
  const cols = columns.map((c) => `  ${quoteIdent(c.name, dialect)} ${columnSql(c.type, dialect)}`).join(",\n");
  const t = quoteIdent(table, dialect);
  if (dialect === "mssql") {
    return `IF OBJECT_ID(N'${table.replace(/'/g, "''")}', N'U') IS NULL\nCREATE TABLE ${t} (\n${cols}\n);\n`;
  }
  return `CREATE TABLE IF NOT EXISTS ${t} (\n${cols}\n);\n`;
}

export function deleteRowsSql(table: string, dialect: Dialect): string {
  return `DELETE FROM ${quoteIdent(table, dialect)};\n`;
}

export function* insertStatements(
  table: string,
  columns: Column[],
  rows: Iterable<Row>,
  dialect: Dialect,
  batchSize = 500,
): Generator<string> {
  const size = Math.max(1, Math.min(batchSize, MAX_BATCH));
  const head = `INSERT INTO ${quoteIdent(table, dialect)} (${columns.map((c) => quoteIdent(c.name, dialect)).join(", ")}) VALUES\n`;
  let batch: string[] = [];
  for (const row of rows) {
    const values = flattenRow(row, columns).map((v, i) => sqlLiteral(v, columns[i]!, dialect));
    batch.push(`(${values.join(", ")})`);
    if (batch.length === size) {
      yield head + batch.join(",\n") + ";\n";
      batch = [];
    }
  }
  if (batch.length) yield head + batch.join(",\n") + ";\n";
}
