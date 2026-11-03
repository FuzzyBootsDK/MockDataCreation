import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import yazl from "yazl";
import { DIALECTS, DataGenerator, FORMATS, FORMAT_MIME, formatRows, type Dialect, type Format } from "@mockgen/core";
import type { AppContext } from "../app.ts";
import { HttpError } from "../errors.ts";
import { resolveExport, type ExportItem } from "../export-plan.ts";
import { requireSchema } from "./schemas.ts";

export function parseFormat(v: unknown): Format {
  const f = v ?? "json";
  if (!FORMATS.includes(f as Format)) throw new HttpError(400, `format must be one of ${FORMATS.join(", ")}`);
  return f as Format;
}

export function parseDialect(v: unknown): Dialect {
  const d = v ?? "pg";
  if (!DIALECTS.includes(d as Dialect)) throw new HttpError(400, `dialect must be one of ${DIALECTS.join(", ")}`);
  return d as Dialect;
}

export function parseCount(v: unknown, fallback: number, maxRows: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > maxRows) throw new HttpError(400, `count must be an integer between 0 and ${maxRows}`);
  return n;
}

function parseSeed(v: unknown, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 31 - 1) throw new HttpError(400, "seed must be a non-negative integer");
  return n;
}

const truthy = (v: unknown) => v === true || v === "true" || v === "1";

function attachment(reply: FastifyReply, mime: string, filename: string) {
  return reply.type(mime).header("content-disposition", `attachment; filename="${filename}"`);
}

function stream(chunks: Iterable<string>, gen: DataGenerator, app: FastifyInstance, label: string): Readable {
  const s = Readable.from(chunks);
  s.on("end", () => {
    if (gen.warnings) app.log.warn({ label, warnings: gen.warnings }, "formula warnings during generation");
  });
  return s;
}

function* concat(parts: Iterable<string>[]): Generator<string> {
  for (const p of parts) yield* p;
}

export function generateRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    "/api/schemas/:id/generate",
    async (req, reply) => {
      const schema = requireSchema(ctx, req.params.id);
      const q = req.query;
      const format = parseFormat(q.format);
      const dialect = parseDialect(q.dialect);
      const count = parseCount(q.count, schema.defaultCount, ctx.config.maxRows);
      const seed = parseSeed(q.seed, schema.seed);
      const all = ctx.schemas.all();
      const gen = new DataGenerator(all);
      const chunks = formatRows(format, schema, all, gen.rows(schema.id, count, seed), { dialect, ddl: truthy(q.ddl) });
      return attachment(reply, FORMAT_MIME[format], `${schema.slug}.${format}`).send(stream(chunks, gen, app, schema.slug));
    },
  );

  app.post<{
    Body: { schemaIds?: string[]; counts?: Record<string, number>; format?: string; dialect?: string; seed?: number; ddl?: boolean };
  }>("/api/generate", async (req, reply) => {
    const body = req.body ?? {};
    const format = parseFormat(body.format);
    const dialect = parseDialect(body.dialect);
    const all = ctx.schemas.all();
    const requested = (body.schemaIds ?? []).map((id) => ({ id, count: body.counts?.[id] }));
    const { items, seed } = resolveExport(all, requested, {
      maxRows: ctx.config.maxRows,
      seed: body.seed === undefined ? undefined : parseSeed(body.seed, 0),
    });
    const gen = new DataGenerator(all);
    const fileFor = (item: ExportItem) =>
      formatRows(format, item.schema, all, gen.rows(item.schema.id, item.count, seed), { dialect, ddl: body.ddl === true });

    if (format === "sql") {
      const chunks = concat(items.map((i) => fileFor(i)));
      return attachment(reply, FORMAT_MIME.sql, "mockgen.sql").send(stream(chunks, gen, app, "mockgen.sql"));
    }

    const zip = new yazl.ZipFile();
    for (const item of items) zip.addReadStream(Readable.from(fileFor(item)), `${item.schema.slug}.${format}`);
    zip.end();
    return attachment(reply, "application/zip", "mockgen.zip").send(zip.outputStream);
  });
}
