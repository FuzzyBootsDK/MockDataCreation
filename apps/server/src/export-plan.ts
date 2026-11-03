import { referencedSchemaIds, withDependencies, type Schema } from "@mockgen/core";
import { HttpError } from "./errors.ts";

export interface ExportItem {
  schema: Schema;
  count: number;
}

export function resolveExport(
  all: Schema[],
  requested: { id: string; count?: number }[],
  opts: { maxRows: number; seed?: number },
): { items: ExportItem[]; seed: number } {
  if (!requested.length) throw new HttpError(400, "Choose at least one schema");
  let ids: string[];
  try {
    ids = withDependencies(all, requested.map((r) => r.id));
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  const referenced = new Set(ids.flatMap((id) => referencedSchemaIds(byId.get(id)!)));
  const items = ids.map((id) => {
    const schema = byId.get(id)!;
    const explicit = requested.find((r) => r.id === id)?.count;
    if (explicit !== undefined && referenced.has(id) && explicit !== schema.defaultCount) {
      throw new HttpError(
        400,
        `Schema "${schema.slug}" is referenced by another schema, so its count must equal its defaultCount (${schema.defaultCount})`,
      );
    }
    const count = explicit ?? schema.defaultCount;
    if (!Number.isInteger(count) || count < 0 || count > opts.maxRows) {
      throw new HttpError(400, `Count for "${schema.slug}" must be an integer between 0 and ${opts.maxRows}`);
    }
    return { schema, count };
  });
  return { items, seed: opts.seed ?? byId.get(requested[0]!.id)!.seed };
}
