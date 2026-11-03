import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { errorHandler } from "./errors.ts";
import { SchemaRepo } from "./repo/schemas.ts";
import { healthRoutes } from "./routes/health.ts";

export interface AppContext {
  config: Config;
  db: Db;
  schemas: SchemaRepo;
}

export async function buildApp(opts: { config: Config; db: Db; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });
  const ctx: AppContext = { config: opts.config, db: opts.db, schemas: new SchemaRepo(opts.db) };
  app.setErrorHandler(errorHandler);
  healthRoutes(app);
  void ctx;
  return app;
}
