import type { FastifyInstance } from "fastify";
import { DataGenerator, type Row, type Schema } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { HttpError } from "../errors.ts";

const MAX_PAGE_SIZE = 1000;

function intParam(v: string | undefined, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `${name} must be an integer between 1 and ${max}`);
  return n;
}

function idStart(schema: Schema): number {
  const field = schema.fields.find((f) => f.name === "id" && f.type === "rowNumber");
  if (!field) throw new HttpError(404, `Schema "${schema.slug}" needs a top-level "id" field of type rowNumber for by-id requests`);
  return typeof field.options.start === "number" ? field.options.start : 1;
}

function bodyObject(body: unknown): Row {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Body must be a JSON object");
  return body as Row;
}

export function mockRoutes(app: FastifyInstance, ctx: AppContext) {
  const mockSchema = (slug: string): Schema => {
    const schema = ctx.schemas.getBySlug(slug);
    if (!schema || !schema.mockEnabled) throw new HttpError(404, `No mock endpoint for "${slug}"`);
    return schema;
  };

  const rowById = (schema: Schema, rawId: string): { row: Row; id: number } => {
    const start = idStart(schema);
    const id = Number(rawId);
    const index = id - start;
    if (!Number.isInteger(id) || index < 0 || index >= schema.defaultCount) throw new HttpError(404, "Not found");
    const row = new DataGenerator(ctx.schemas.all()).row(schema.id, index, schema.seed);
    return { row, id };
  };

  app.get<{ Params: { slug: string }; Querystring: Record<string, string | undefined> }>("/mock/:slug", async (req) => {
    const schema = mockSchema(req.params.slug);
    const { page: rawPage, pageSize: rawSize, ...filters } = req.query;
    const page = intParam(rawPage, "page", 1);
    const pageSize = intParam(rawSize, "pageSize", 20, MAX_PAGE_SIZE);
    const gen = new DataGenerator(ctx.schemas.all());
    const offset = (page - 1) * pageSize;

    const keys = Object.keys(filters);
    if (!keys.length) {
      const end = Math.min(offset + pageSize, schema.defaultCount);
      const data: Row[] = [];
      for (let i = offset; i < end; i++) data.push(gen.row(schema.id, i, schema.seed));
      return { data, page, pageSize, total: schema.defaultCount };
    }

    const topLevel = new Set(schema.fields.map((f) => f.name));
    const unknown = keys.filter((k) => !topLevel.has(k));
    if (unknown.length) throw new HttpError(400, `Unknown filter field: ${unknown.join(", ")}`);
    const matches: Row[] = [];
    const scan = Math.min(schema.defaultCount, ctx.config.mockScanLimit);
    for (const row of gen.rows(schema.id, scan, schema.seed)) {
      if (keys.every((k) => String(row[k]) === filters[k])) matches.push(row);
    }
    return { data: matches.slice(offset, offset + pageSize), page, pageSize, total: matches.length };
  });

  app.get<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", async (req) => {
    return rowById(mockSchema(req.params.slug), req.params.id).row;
  });

  app.post<{ Params: { slug: string } }>("/mock/:slug", async (req, reply) => {
    const schema = mockSchema(req.params.slug);
    const body = bodyObject(req.body);
    return reply.status(201).send({ ...body, id: idStart(schema) + schema.defaultCount });
  });

  const update = async (req: { params: { slug: string; id: string }; body: unknown }) => {
    const { row, id } = rowById(mockSchema(req.params.slug), req.params.id);
    return { ...row, ...bodyObject(req.body), id };
  };
  app.put<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", update);
  app.patch<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", update);

  app.delete<{ Params: { slug: string; id: string } }>("/mock/:slug/:id", async (req, reply) => {
    rowById(mockSchema(req.params.slug), req.params.id);
    return reply.status(204).send();
  });
}
