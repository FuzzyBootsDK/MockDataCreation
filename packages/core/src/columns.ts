export type Dialect = "pg" | "mssql" | "sqlite";
export const DIALECTS: readonly Dialect[] = ["pg", "mssql", "sqlite"];

export type ColumnType = "text" | "int" | "bigint" | "decimal" | "bool" | "date" | "datetime" | "uuid" | "json";
export const COLUMN_TYPES: readonly ColumnType[] = [
  "text", "int", "bigint", "decimal", "bool", "date", "datetime", "uuid", "json",
];

const SQL_TYPES: Record<Dialect, Record<ColumnType, string>> = {
  pg: {
    text: "text", int: "integer", bigint: "bigint", decimal: "numeric", bool: "boolean",
    date: "date", datetime: "timestamp", uuid: "uuid", json: "jsonb",
  },
  mssql: {
    text: "nvarchar(max)", int: "int", bigint: "bigint", decimal: "decimal(18,4)", bool: "bit",
    date: "date", datetime: "datetime2", uuid: "uniqueidentifier", json: "nvarchar(max)",
  },
  sqlite: {
    text: "TEXT", int: "INTEGER", bigint: "INTEGER", decimal: "REAL", bool: "INTEGER",
    date: "TEXT", datetime: "TEXT", uuid: "TEXT", json: "TEXT",
  },
};

export function columnSql(type: ColumnType, dialect: Dialect): string {
  return SQL_TYPES[dialect][type];
}
