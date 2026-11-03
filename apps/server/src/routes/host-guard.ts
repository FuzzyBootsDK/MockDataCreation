import type { FastifyInstance } from "fastify";
import type { Config } from "../config.ts";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(header: string | undefined): string {
  const h = (header ?? "").trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

/** DNS-rebinding protection: only loopback names and ALLOWED_HOSTS may address the server. */
export function hostGuard(app: FastifyInstance, config: Config) {
  const allowed = new Set([...LOOPBACK, ...config.allowedHosts]);
  app.addHook("onRequest", async (req, reply) => {
    if (!allowed.has(hostname(req.headers.host))) return reply.status(403).send({ error: "Host not allowed" });
  });
}
