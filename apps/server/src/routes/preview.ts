import type { FastifyInstance } from "fastify";
import { DataGenerator, validateSchema, type Schema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { ValidationFailed } from "../errors.ts";

const PREVIEW_ID = "__preview__";
const MAX_PREVIEW = 100;

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Validates an unsaved schema. Name and slug don't affect the rows, so blank ones get placeholders:
 * a brand-new schema previews and downloads before the user has named it.
 */
export function validateDraft(input: Record<string, unknown>, others: Schema[]): Schema {
  const draft: Record<string, unknown> = { ...input, id: input.id ?? PREVIEW_ID };
  if (blank(draft.name)) draft.name = "Mock data";
  if (blank(draft.slug)) {
    const slugs = new Set(others.filter((s) => s.id !== draft.id).map((s) => s.slug));
    let slug = "mock-data";
    for (let n = 2; slugs.has(slug); n++) slug = `mock-data-${n}`;
    draft.slug = slug;
  }
  const { schema, issues } = validateSchema(draft, others);
  if (!schema) throw new ValidationFailed(issues);
  return schema;
}

export function previewRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: { schema?: Record<string, unknown>; count?: number } }>("/api/preview", async (req) => {
    const others = ctx.schemas.all();
    const schema = validateDraft(req.body?.schema ?? {}, others);
    const count = Math.max(1, Math.min(Number(req.body?.count ?? 10) || 10, MAX_PREVIEW));
    const gen = new DataGenerator([...others.filter((s) => s.id !== schema.id), schema]);
    const rows = [...gen.rows(schema.id, Math.min(count, schema.defaultCount), schema.seed)];
    return { rows, warnings: gen.warnings };
  });
}
