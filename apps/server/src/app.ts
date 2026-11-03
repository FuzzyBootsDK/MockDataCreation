import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { errorHandler } from "./errors.ts";
import { ConnectionRepo } from "./repo/connections.ts";
import { SchemaRepo } from "./repo/schemas.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { docsRoutes } from "./routes/docs.ts";
import { generateRoutes } from "./routes/generate.ts";
import { hostGuard } from "./routes/host-guard.ts";
import { healthRoutes } from "./routes/health.ts";
import { mockRoutes } from "./routes/mock.ts";
import { previewRoutes } from "./routes/preview.ts";
import { schemaRoutes } from "./routes/schemas.ts";
import { seedRoutes } from "./routes/seed.ts";
import { typeRoutes } from "./routes/types.ts";
import { webRoutes } from "./routes/web.ts";
import { SeedJobs } from "./seed/jobs.ts";

export interface AppContext {
  config: Config;
  db: Db;
  schemas: SchemaRepo;
  connections: ConnectionRepo;
  seedJobs: SeedJobs;
}

export async function buildApp(opts: { config: Config; db: Db; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });
  const ctx: AppContext = { config: opts.config, db: opts.db, schemas: new SchemaRepo(opts.db), connections: new ConnectionRepo(opts.db), seedJobs: new SeedJobs() };
  app.setErrorHandler(errorHandler);
  hostGuard(app, opts.config);
  await docsRoutes(app);
  healthRoutes(app);
  typeRoutes(app, ctx);
  schemaRoutes(app, ctx);
  previewRoutes(app, ctx);
  generateRoutes(app, ctx);
  mockRoutes(app, ctx);
  connectionRoutes(app, ctx);
  seedRoutes(app, ctx);
  await webRoutes(app, ctx);
  return app;
}
