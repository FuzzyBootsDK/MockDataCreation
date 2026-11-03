import type { Dialect } from "../columns.ts";
import type { Row, Schema } from "../model.ts";
import { toCsv } from "./csv.ts";
import { flattenColumns } from "./flatten.ts";
import { toJsonArray, toNdjson } from "./json.ts";
import { createTableSql, insertStatements } from "./sql.ts";

export type Format = "csv" | "json" | "ndjson" | "sql";
export const FORMATS: readonly Format[] = ["csv", "json", "ndjson", "sql"];
export const FORMAT_MIME: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  sql: "application/sql; charset=utf-8",
};

export interface FormatOptions {
  dialect?: Dialect;
  ddl?: boolean;
}

export function* formatRows(
  format: Format,
  schema: Schema,
  schemas: Schema[],
  rows: Iterable<Row>,
  opts: FormatOptions = {},
): Generator<string> {
  switch (format) {
    case "json":
      return yield* toJsonArray(rows);
    case "ndjson":
      return yield* toNdjson(rows);
    case "csv":
      return yield* toCsv(flattenColumns(schema.fields, schemas), rows);
    case "sql": {
      const dialect = opts.dialect ?? "pg";
      const columns = flattenColumns(schema.fields, schemas);
      if (opts.ddl) yield createTableSql(schema.slug, columns, dialect) + "\n";
      return yield* insertStatements(schema.slug, columns, rows, dialect);
    }
  }
}
