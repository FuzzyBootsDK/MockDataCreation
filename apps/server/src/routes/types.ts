import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.ts";
import { DIALECTS, FORMATS, HELPER_NAMES, LOCALES, describeFieldTypes } from "@mockgen/core";

export function typeRoutes(app: FastifyInstance, ctx: AppContext) {
  const body = {
    types: describeFieldTypes(),
    locales: LOCALES,
    formats: FORMATS,
    dialects: DIALECTS,
    helpers: [...HELPER_NAMES],
    maxRows: ctx.config.maxRows,
  };
  app.get("/api/types", async () => body);
}
