import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.ts";
import { HttpError } from "../errors.ts";
import { resolveExport } from "../export-plan.ts";
import { SEED_MODES, runSeed, type SeedEvent, type SeedMode } from "../seed/runner.ts";
import { openTarget, type SeedTarget } from "../seed/targets.ts";
import { requireConnection } from "./connections.ts";

interface SeedBody {
  connectionId?: string;
  schemas?: { id: string; count?: number }[];
  mode?: string;
  seed?: number;
}

export function seedRoutes(app: FastifyInstance, ctx: AppContext) {
  const requireJob = (id: string) => {
    const job = ctx.seedJobs.get(id);
    if (!job) throw new HttpError(404, `Seed job ${id} not found`);
    return job;
  };

  app.post<{ Body: SeedBody }>("/api/seed", async (req, reply) => {
    const body = req.body ?? {};
    if (!SEED_MODES.includes(body.mode as SeedMode)) throw new HttpError(400, `mode must be one of ${SEED_MODES.join(", ")}`);
    const conn = requireConnection(ctx, String(body.connectionId));
    const all = ctx.schemas.all();
    if (!Array.isArray(body.schemas)) throw new HttpError(400, "schemas must be an array");
    const { items, seed } = resolveExport(all, body.schemas, { maxRows: ctx.config.maxRows, seed: body.seed });
    const job = ctx.seedJobs.create();
    const emit = (e: SeedEvent) => ctx.seedJobs.emit(job, e);

    void (async () => {
      let target: SeedTarget | undefined;
      try {
        target = await openTarget(conn, { dataDir: ctx.config.dataDir, env: process.env });
        await runSeed(target, { all, items, seed, mode: body.mode as SeedMode }, emit);
      } catch (e) {
        emit({ type: "error", table: "", batch: 0, message: (e as Error).message });
        emit({ type: "done", ok: false, warnings: 0 });
      } finally {
        await target?.close().catch(() => {});
      }
    })();

    return reply.status(202).send({ jobId: job.id });
  });

  app.get<{ Params: { jobId: string } }>("/api/seed/:jobId", async (req) => {
    const job = requireJob(req.params.jobId);
    return { id: job.id, done: job.done, events: job.events };
  });

  app.get<{ Params: { jobId: string } }>("/api/seed/:jobId/events", (req, reply) => {
    const job = requireJob(req.params.jobId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: SeedEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const e of job.events) send(e);
    if (job.done) return void res.end();
    const unsubscribe = ctx.seedJobs.subscribe(job, (e) => {
      send(e);
      if (e.type === "done") {
        unsubscribe();
        res.end();
      }
    });
    req.raw.on("close", unsubscribe);
  });
}
