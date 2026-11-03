import { describe, expect, test } from "vitest";
import { SchemaSchema } from "@mockgen/core";
import { openDb } from "../src/db.ts";
import { SchemaRepo } from "../src/repo/schemas.ts";

const s = (id: string, slug: string, name = slug) =>
  SchemaSchema.parse({ id, name, slug, fields: [{ name: "id", type: "rowNumber" }] });

describe("SchemaRepo", () => {
  test("save, get, getBySlug, all (sorted by name), update, delete", () => {
    const repo = new SchemaRepo(openDb(":memory:"));
    repo.save(s("1", "zeta", "Zeta"));
    repo.save(s("2", "alpha", "Alpha"));
    expect(repo.all().map((x) => x.slug)).toEqual(["alpha", "zeta"]);
    expect(repo.get("1")?.slug).toBe("zeta");
    expect(repo.getBySlug("alpha")?.id).toBe("2");
    repo.save({ ...s("1", "omega", "Omega") });
    expect(repo.get("1")?.slug).toBe("omega");
    expect(repo.getBySlug("zeta")).toBeUndefined();
    expect(repo.delete("1")).toBe(true);
    expect(repo.delete("1")).toBe(false);
    expect(repo.all()).toHaveLength(1);
  });
});
