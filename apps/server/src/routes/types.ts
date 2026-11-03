import type { FastifyInstance } from "fastify";
import { DIALECTS, FORMATS, HELPER_NAMES, LOCALES, describeFieldTypes } from "@mockgen/core";

export function typeRoutes(app: FastifyInstance) {
  const body = {
    types: describeFieldTypes(),
    locales: LOCALES,
    formats: FORMATS,
    dialects: DIALECTS,
    helpers: [...HELPER_NAMES],
  };
  app.get("/api/types", async () => body);
}
