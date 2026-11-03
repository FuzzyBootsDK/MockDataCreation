import type { Row } from "../model.ts";
import { flattenRow, type Column } from "./flatten.ts";

export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function* toCsv(columns: Column[], rows: Iterable<Row>): Generator<string> {
  yield columns.map((c) => csvCell(c.name)).join(",") + "\r\n";
  for (const row of rows) yield flattenRow(row, columns).map(csvCell).join(",") + "\r\n";
}
