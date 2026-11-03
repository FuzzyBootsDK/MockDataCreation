import type { FastifyInstance } from "fastify";

export function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));
}
