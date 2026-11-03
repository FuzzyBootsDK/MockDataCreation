import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppContext } from "../app.ts";

const API_PREFIXES = ["/api", "/mock", "/docs", "/health"];

export async function webRoutes(app: FastifyInstance, ctx: AppContext) {
  const webDir = ctx.config.webDir;
  if (webDir) await app.register(fastifyStatic, { root: webDir, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`) || req.url.startsWith(`${p}?`));
    if (webDir && !isApi && req.method === "GET") return reply.sendFile("index.html");
    return reply.status(404).send({ error: "Not found" });
  });
}
