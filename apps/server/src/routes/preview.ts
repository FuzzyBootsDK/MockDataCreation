import type { FastifyInstance } from "fastify";
import { DataGenerator, validateSchema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { ValidationFailed } from "../errors.ts";

const PREVIEW_ID = "__preview__";
const MAX_PREVIEW = 100;

export function previewRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: { schema?: Record<string, unknown>; count?: number } }>("/api/preview", async (req) => {
    const input = req.body?.schema ?? {};
    const others = ctx.schemas.all();
    const { schema, issues } = validateSchema({ ...input, id: input.id ?? PREVIEW_ID }, others);
    if (!schema) throw new ValidationFailed(issues);
    const count = Math.max(1, Math.min(Number(req.body?.count ?? 10) || 10, MAX_PREVIEW));
    const gen = new DataGenerator([...others.filter((s) => s.id !== schema.id), schema]);
    const rows = [...gen.rows(schema.id, Math.min(count, schema.defaultCount), schema.seed)];
    return { rows, warnings: gen.warnings };
  });
}
