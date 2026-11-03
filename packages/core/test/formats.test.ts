import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema } from "../src/model.ts";
import { flattenColumns, flattenRow } from "../src/formats/flatten.ts";
import { csvCell, toCsv } from "../src/formats/csv.ts";
import { toJsonArray, toNdjson } from "../src/formats/json.ts";
import { createTableSql, deleteRowsSql, insertStatements, quoteIdent, sqlLiteral } from "../src/formats/sql.ts";
import { formatRows } from "../src/formats/index.ts";
import { DataGenerator } from "../src/engine/generator.ts";

const customers = SchemaSchema.parse({
  id: "c",
  name: "C",
  slug: "customers",
  fields: [{ name: "id", type: "uuid" }],
});

const people = SchemaSchema.parse({
  id: "p",
  name: "P",
  slug: "people",
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "name", type: "person.firstName" },
    { name: "active", type: "boolean" },
    { name: "born", type: "date.birthdate" },
    { name: "customer_id", type: "reference", options: { schemaId: "c", fieldName: "id" } },
    { name: "address", type: "object", children: [{ name: "city", type: "location.city" }] },
    { name: "tags", type: "array", children: [{ name: "t", type: "word.noun" }] },
  ],
});

const schemas: Schema[] = [customers, people];
const row = {
  id: 1,
  name: "O'Brien, \"Al\"",
  active: true,
  born: "1990-05-01",
  customer_id: "6f1c0000-0000-4000-8000-000000000000",
  address: { city: "Aarhus" },
  tags: ["a", "b"],
};

describe("flatten", () => {
  test("columns flatten objects, keep arrays as json and resolve reference types", () => {
    expect(flattenColumns(people.fields, schemas).map((c) => [c.name, c.type])).toEqual([
      ["id", "bigint"],
      ["name", "text"],
      ["active", "bool"],
      ["born", "date"],
      ["customer_id", "uuid"],
      ["address_city", "text"],
      ["tags", "json"],
    ]);
  });

  test("row values follow columns", () => {
    const cols = flattenColumns(people.fields, schemas);
    expect(flattenRow(row, cols)).toEqual([
      1, "O'Brien, \"Al\"", true, "1990-05-01", "6f1c0000-0000-4000-8000-000000000000", "Aarhus", '["a","b"]',
    ]);
    expect(flattenRow({ ...row, address: null }, cols)[5]).toBeNull();
  });
});

describe("csv", () => {
  test("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(false)).toBe("false");
  });

  test("header + rows with CRLF", () => {
    const cols = flattenColumns(people.fields, schemas);
    const out = [...toCsv(cols, [row])].join("");
    expect(out).toBe(
      'id,name,active,born,customer_id,address_city,tags\r\n' +
        '1,"O\'Brien, ""Al""",true,1990-05-01,6f1c0000-0000-4000-8000-000000000000,Aarhus,"[""a"",""b""]"\r\n',
    );
  });
});

describe("json", () => {
  test("array output parses back", () => {
    expect(JSON.parse([...toJsonArray([row, row])].join(""))).toEqual([row, row]);
    expect(JSON.parse([...toJsonArray([])].join(""))).toEqual([]);
  });

  test("ndjson one object per line", () => {
    const lines = [...toNdjson([row, row])].join("").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(row);
  });
});

describe("sql", () => {
  const cols = flattenColumns(people.fields, schemas);

  test("identifiers", () => {
    expect(quoteIdent("a-b", "pg")).toBe('"a-b"');
    expect(quoteIdent("x]y", "mssql")).toBe("[x]]y]");
  });

  test("literals per dialect", () => {
    const text = cols[1]!;
    const bool = cols[2]!;
    expect(sqlLiteral("O'Brien", text, "pg")).toBe("'O''Brien'");
    expect(sqlLiteral("O'Brien", text, "mssql")).toBe("N'O''Brien'");
    expect(sqlLiteral(true, bool, "pg")).toBe("TRUE");
    expect(sqlLiteral(true, bool, "mssql")).toBe("1");
    expect(sqlLiteral(null, text, "sqlite")).toBe("NULL");
    expect(sqlLiteral(1.5, text, "pg")).toBe("1.5");
    const dt = { name: "d", type: "datetime" as const, path: ["d"] };
    expect(sqlLiteral("2024-01-01T10:00:00.000Z", dt, "mssql")).toBe("N'2024-01-01T10:00:00.000'");
    expect(sqlLiteral("2024-01-01T10:00:00.000Z", dt, "pg")).toBe("'2024-01-01T10:00:00.000Z'");
  });

  test("create table per dialect", () => {
    expect(createTableSql("people", cols.slice(0, 2), "pg")).toBe(
      'CREATE TABLE IF NOT EXISTS "people" (\n  "id" bigint,\n  "name" text\n);\n',
    );
    expect(createTableSql("people", cols.slice(0, 2), "mssql")).toBe(
      "IF OBJECT_ID(N'people', N'U') IS NULL\nCREATE TABLE [people] (\n  [id] bigint,\n  [name] nvarchar(max)\n);\n",
    );
    expect(deleteRowsSql("people", "mssql")).toBe("DELETE FROM [people];\n");
  });

  test("inserts are batched", () => {
    const two = cols.slice(0, 1);
    const stmts = [...insertStatements("t", two, [{ id: 1 }, { id: 2 }, { id: 3 }], "pg", 2)];
    expect(stmts).toEqual(['INSERT INTO "t" ("id") VALUES\n(1),\n(2);\n', 'INSERT INTO "t" ("id") VALUES\n(3);\n']);
  });

  test("batch size is capped at 1000", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    expect([...insertStatements("t", cols.slice(0, 1), rows, "mssql", 5000)]).toHaveLength(2);
  });
});

describe("formatRows", () => {
  test("sql with ddl uses slug as table", () => {
    const out = [...formatRows("sql", customers, schemas, [{ id: "x" }], { dialect: "sqlite", ddl: true })].join("");
    expect(out).toBe('CREATE TABLE IF NOT EXISTS "customers" (\n  "id" TEXT\n);\n\nINSERT INTO "customers" ("id") VALUES\n(\'x\');\n');
  });
});

describe("end to end", () => {
  test("generated rows format to every format deterministically", () => {
    const run = (format: "csv" | "json" | "ndjson" | "sql") => {
      const gen = new DataGenerator(schemas);
      return [...formatRows(format, people, schemas, gen.rows("p", 25, 11), { dialect: "mssql", ddl: true })].join("");
    };
    for (const f of ["csv", "json", "ndjson", "sql"] as const) {
      expect(run(f)).toBe(run(f));
      expect(run(f).length).toBeGreaterThan(100);
    }
    expect(JSON.parse(run("json"))).toHaveLength(25);
  });
});
