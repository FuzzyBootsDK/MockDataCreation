import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { formatPath } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { ConnectionSchema, type Connection } from "../connections/model.ts";
import { HttpError, ValidationFailed } from "../errors.ts";
import { openTarget } from "../seed/targets.ts";

function parse(body: unknown, id: string): Connection {
  const input = { ...(typeof body === "object" && body !== null ? body : {}), id };
  const r = ConnectionSchema.safeParse(input);
  if (!r.success) throw new ValidationFailed(r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })));
  return r.data;
}

export function requireConnection(ctx: AppContext, id: string): Connection {
  const c = ctx.connections.get(id);
  if (!c) throw new HttpError(404, `Connection ${id} not found`);
  return c;
}

export function connectionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/connections", async () => ctx.connections.all());

  app.post("/api/connections", async (req, reply) => {
    const c = parse(req.body, randomUUID());
    ctx.connections.save(c);
    return reply.status(201).send(c);
  });

  app.put<{ Params: { id: string } }>("/api/connections/:id", async (req) => {
    requireConnection(ctx, req.params.id);
    const c = parse(req.body, req.params.id);
    ctx.connections.save(c);
    return c;
  });

  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (req, reply) => {
    if (!ctx.connections.delete(req.params.id)) throw new HttpError(404, `Connection ${req.params.id} not found`);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (req) => {
    const conn = requireConnection(ctx, req.params.id);
    try {
      const target = await openTarget(conn, { dataDir: ctx.config.dataDir, env: process.env });
      try {
        await target.exec("SELECT 1");
      } finally {
        await target.close();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
