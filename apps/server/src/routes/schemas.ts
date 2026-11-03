import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { referencedSchemaIds, validateSchema, type Schema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { HttpError, ValidationFailed } from "../errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireSchema(ctx: AppContext, id: string): Schema {
  const schema = ctx.schemas.get(id);
  if (!schema) throw new HttpError(404, `Schema ${id} not found`);
  return schema;
}

function validated(ctx: AppContext, body: unknown, id: string): Schema {
  const input = { ...(typeof body === "object" && body !== null ? body : {}), id };
  const { schema, issues } = validateSchema(input, ctx.schemas.all());
  if (!schema) throw new ValidationFailed(issues);
  return schema;
}

export function schemaRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/schemas", async () => ctx.schemas.all());

  app.get<{ Params: { id: string } }>("/api/schemas/:id", async (req) => requireSchema(ctx, req.params.id));

  app.post("/api/schemas", async (req, reply) => {
    const sent = (req.body as { id?: unknown } | null)?.id;
    const keep = typeof sent === "string" && UUID.test(sent) && !ctx.schemas.get(sent);
    const schema = validated(ctx, req.body, keep ? sent : randomUUID());
    ctx.schemas.save(schema);
    return reply.status(201).send(schema);
  });

  app.put<{ Params: { id: string } }>("/api/schemas/:id", async (req) => {
    requireSchema(ctx, req.params.id);
    const schema = validated(ctx, req.body, req.params.id);
    ctx.schemas.save(schema);
    return schema;
  });

  app.delete<{ Params: { id: string } }>("/api/schemas/:id", async (req, reply) => {
    const schema = requireSchema(ctx, req.params.id);
    const dependents = ctx.schemas.all().filter((s) => s.id !== schema.id && referencedSchemaIds(s).includes(schema.id));
    if (dependents.length) {
      throw new HttpError(409, `Schema is referenced by: ${dependents.map((s) => s.slug).join(", ")}`);
    }
    ctx.schemas.delete(schema.id);
    return reply.status(204).send();
  });
}
