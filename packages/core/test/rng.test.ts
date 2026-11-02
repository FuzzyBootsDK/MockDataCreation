import { describe, expect, test } from "vitest";
import { Rng, hashSeed } from "../src/rng.ts";

describe("hashSeed", () => {
  test("is stable and unsigned 32-bit", () => {
    const a = hashSeed(42, "schema-a", 7);
    expect(a).toBe(hashSeed(42, "schema-a", 7));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  test("differs when any part differs", () => {
    const base = hashSeed(42, "schema-a", 7);
    expect(hashSeed(43, "schema-a", 7)).not.toBe(base);
    expect(hashSeed(42, "schema-b", 7)).not.toBe(base);
    expect(hashSeed(42, "schema-a", 8)).not.toBe(base);
  });

  test("part boundaries matter", () => {
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
  });
});

describe("Rng", () => {
  test("same seed gives same sequence", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("next is in [0, 1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int is inclusive and covers the range", () => {
    const r = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  test("chance respects 0 and 100", () => {
    const r = new Rng(5);
    for (let i = 0; i < 100; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(100)).toBe(true);
    }
  });

  test("chance(30) is roughly 30%", () => {
    const r = new Rng(77);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (r.chance(30)) hits++;
    expect(hits).toBeGreaterThan(2_700);
    expect(hits).toBeLessThan(3_300);
  });
});
