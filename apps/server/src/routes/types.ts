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
    // The browser already fetches this before it draws anything, so it is the one round trip that
    // can tell the UI whether to offer connections and seeding at all. Hiding those is cosmetic —
    // the routes are simply absent — but a button that always 404s is worse than no button.
    dbTargets: ctx.config.dbTargets,
  };
  app.get("/api/types", async () => body);
}
