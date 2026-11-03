import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppContext } from "../app.ts";

const API_PREFIXES = ["/api", "/mock", "/docs", "/health"];

// Normalise the request path for routing decisions: strip the query string, decode,
// collapse repeated slashes and lowercase. Returns null when the path is not decodable.
function normalisedPath(rawUrl: string): string | null {
  const pathname = rawUrl.split("?")[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return decoded.replace(/\/{2,}/g, "/").toLowerCase();
}

function isApiPath(p: string): boolean {
  return API_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

function looksLikeAsset(p: string): boolean {
  const last = p.split("/").pop() ?? "";
  return last.includes(".");
}

export async function webRoutes(app: FastifyInstance, ctx: AppContext) {
  const webDir = ctx.config.webDir;
  if (webDir) await app.register(fastifyStatic, { root: webDir, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    const p = normalisedPath(req.url);
    const isPageRoute =
      p !== null && !isApiPath(p) && !looksLikeAsset(p) && (req.method === "GET" || req.method === "HEAD");
    if (webDir && isPageRoute) return reply.sendFile("index.html");
    return reply.status(404).send({ error: "Not found" });
  });
}
