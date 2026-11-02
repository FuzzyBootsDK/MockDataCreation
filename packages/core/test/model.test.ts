import { describe, expect, test } from "vitest";
import { SchemaSchema } from "../src/model.ts";
import { columnSql } from "../src/columns.ts";

describe("SchemaSchema", () => {
  test("applies defaults", () => {
    const s = SchemaSchema.parse({
      id: "s1",
      name: "Customers",
      slug: "customers",
      fields: [{ name: "id", type: "rowNumber" }],
    });
    expect(s.locale).toBe("en");
    expect(s.defaultCount).toBe(100);
    expect(s.seed).toBe(1);
    expect(s.mockEnabled).toBe(false);
    expect(s.fields[0]).toEqual({ name: "id", type: "rowNumber", options: {}, blankPercent: 0 });
  });

  test("parses nested children", () => {
    const s = SchemaSchema.parse({
      id: "s1",
      name: "X",
      slug: "x",
      fields: [{ name: "address", type: "object", children: [{ name: "city", type: "location.city" }] }],
    });
    expect(s.fields[0]?.children?.[0]?.name).toBe("city");
  });

  test("rejects bad slug and field name", () => {
    const r = SchemaSchema.safeParse({
      id: "s1",
      name: "X",
      slug: "Bad Slug",
      fields: [{ name: "1abc", type: "uuid" }],
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("slug");
    expect(paths).toContain("fields.0.name");
  });

  test("rejects empty field list and out-of-range blankPercent", () => {
    expect(SchemaSchema.safeParse({ id: "s", name: "X", slug: "x", fields: [] }).success).toBe(false);
    expect(
      SchemaSchema.safeParse({ id: "s", name: "X", slug: "x", fields: [{ name: "a", type: "uuid", blankPercent: 101 }] })
        .success,
    ).toBe(false);
  });
});

describe("columnSql", () => {
  test("maps per dialect", () => {
    expect(columnSql("uuid", "pg")).toBe("uuid");
    expect(columnSql("uuid", "mssql")).toBe("uniqueidentifier");
    expect(columnSql("uuid", "sqlite")).toBe("TEXT");
    expect(columnSql("bool", "mssql")).toBe("bit");
    expect(columnSql("datetime", "pg")).toBe("timestamp");
  });
});
