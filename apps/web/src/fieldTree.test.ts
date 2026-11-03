import { describe, expect, test } from "vitest";
import type { Field, Schema } from "@mockgen/core";
import {
  appendTo, getAt, issuesAt, moveWithin, newField, newId, pathString, referencedIds, removeAt, slugify, updateAt,
} from "./fieldTree.ts";

const f = (name: string, children?: Field[]): Field => ({ name, type: children ? "object" : "uuid", options: {}, blankPercent: 0, children });
const tree: Field[] = [f("a"), f("obj", [f("x"), f("y", [f("deep")])]), f("b")];

describe("fieldTree", () => {
  test("getAt walks children", () => {
    expect(getAt(tree, [1, 1, 0])?.name).toBe("deep");
    expect(getAt(tree, [9])).toBeUndefined();
  });

  test("updateAt is immutable", () => {
    const next = updateAt(tree, [1, 0], { name: "renamed" });
    expect(getAt(next, [1, 0])?.name).toBe("renamed");
    expect(getAt(tree, [1, 0])?.name).toBe("x");
    expect(next[0]).toBe(tree[0]);
  });

  test("removeAt, appendTo, moveWithin", () => {
    expect(removeAt(tree, [1, 1])[1]!.children!.map((c) => c.name)).toEqual(["x"]);
    expect(appendTo(tree, [1], f("z"))[1]!.children!.map((c) => c.name)).toEqual(["x", "y", "z"]);
    expect(appendTo(tree, [], f("c")).map((c) => c.name)).toEqual(["a", "obj", "b", "c"]);
    expect(moveWithin(tree, [], 2, 0).map((c) => c.name)).toEqual(["b", "a", "obj"]);
    expect(moveWithin(tree, [1], 0, 1)[1]!.children!.map((c) => c.name)).toEqual(["y", "x"]);
  });

  test("newField picks a unique name", () => {
    expect(newField([f("field_1"), f("field_2")]).name).toBe("field_3");
    expect(newField([f("field_3")]).name).toBe("field_1");
  });

  test("pathString and issuesAt", () => {
    expect(pathString([1, 0])).toBe("fields[1].children[0]");
    const issues = [
      { path: "fields[1].name", message: "dup" },
      { path: "fields[1].children", message: "need children" },
      { path: "fields[1].children[0].type", message: "nested" },
      { path: "fields[1].options.min", message: "min" },
      { path: "fields[10].name", message: "other" },
    ];
    expect(issuesAt(issues, [1])).toEqual({ name: "dup", children: "need children", "options.min": "min" });
    expect(issuesAt(issues, [1, 0])).toEqual({ type: "nested" });
  });

  test("slugify", () => {
    expect(slugify("  Order Lines (DK) ")).toBe("order-lines-dk");
    expect(slugify("Kunder æøå")).toBe("kunder-aeoa");
  });

  test("newId falls back when crypto.randomUUID is missing (plain HTTP)", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newId()).toMatch(uuid);
    const original = crypto.randomUUID;
    try {
      Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
      expect(newId()).toMatch(uuid);
      expect(newId()).not.toBe(newId());
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  test("referencedIds is transitive and parent-first", () => {
    const s = (id: string, refs: string[]): Schema => ({
      id, name: id, slug: id, locale: "en", defaultCount: 1, seed: 1, mockEnabled: false,
      fields: refs.map((r, i) => ({ name: `r${i}`, type: "reference", options: { schemaId: r, fieldName: "id" }, blankPercent: 0 })),
    });
    const all = [s("orders", ["customers"]), s("customers", ["regions"]), s("regions", [])];
    expect(referencedIds(all[0]!, all)).toEqual(["regions", "customers"]);
  });
});
