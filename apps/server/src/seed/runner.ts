import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  DataGenerator, createTableSql, deleteRowsSql, flattenColumns, insertStatements, type Schema,
} from "@mockgen/core";
import type { ExportItem } from "../export-plan.ts";
import type { SeedTarget } from "./targets.ts";

export type SeedMode = "create" | "append" | "truncate";
export const SEED_MODES: readonly SeedMode[] = ["create", "append", "truncate"];
export const SEED_BATCH = 500;

export type SeedEvent =
  | { type: "start"; tables: { table: string; total: number }[] }
  | { type: "progress"; table: string; inserted: number; total: number }
  | { type: "table-done"; table: string; inserted: number }
  | { type: "error"; table: string; batch: number; message: string }
  | { type: "done"; ok: boolean; warnings: number };

export interface SeedPlan {
  all: Schema[];
  items: ExportItem[];
  seed: number;
  mode: SeedMode;
}

export async function runSeed(target: SeedTarget, plan: SeedPlan, emit: (e: SeedEvent) => void): Promise<boolean> {
  const gen = new DataGenerator(plan.all);
  const tables = plan.items.map((item) => ({ item, table: item.schema.slug, columns: flattenColumns(item.schema.fields, plan.all) }));
  emit({ type: "start", tables: tables.map((t) => ({ table: t.table, total: t.item.count })) });

  let current = "";
  let batch = 0;
  try {
    if (plan.mode === "create") {
      for (const t of tables) {
        current = t.table;
        await target.exec(createTableSql(t.table, t.columns, target.dialect));
      }
    }
    if (plan.mode === "truncate") {
      await target.begin();
      for (const t of [...tables].reverse()) {
        current = t.table;
        await target.exec(deleteRowsSql(t.table, target.dialect));
      }
      await target.commit();
    }
    for (const t of tables) {
      current = t.table;
      batch = 0;
      const total = t.item.count;
      await target.begin();
      const rows = gen.rows(t.item.schema.id, total, plan.seed);
      for (const stmt of insertStatements(t.table, t.columns, rows, target.dialect, SEED_BATCH)) {
        batch++;
        await target.exec(stmt);
        emit({ type: "progress", table: t.table, inserted: Math.min(batch * SEED_BATCH, total), total });
        await yieldToEventLoop();
      }
      await target.commit();
      emit({ type: "table-done", table: t.table, inserted: total });
    }
    emit({ type: "done", ok: true, warnings: gen.warnings });
    return true;
  } catch (e) {
    await target.rollback().catch(() => {});
    emit({ type: "error", table: current, batch, message: (e as Error).message });
    emit({ type: "done", ok: false, warnings: gen.warnings });
    return false;
  }
}
