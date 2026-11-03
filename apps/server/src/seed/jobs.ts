import { randomUUID } from "node:crypto";
import type { SeedEvent } from "./runner.ts";

const MAX_JOBS = 20;

export interface SeedJob {
  id: string;
  events: SeedEvent[];
  done: boolean;
}

interface Entry extends SeedJob {
  listeners: Set<(e: SeedEvent) => void>;
}

export class SeedJobs {
  readonly #jobs = new Map<string, Entry>();

  create(): SeedJob {
    const job: Entry = { id: randomUUID(), events: [], done: false, listeners: new Set() };
    this.#jobs.set(job.id, job);
    while (this.#jobs.size > MAX_JOBS) this.#jobs.delete(this.#jobs.keys().next().value!);
    return job;
  }

  get(id: string): SeedJob | undefined {
    return this.#jobs.get(id);
  }

  emit(job: SeedJob, e: SeedEvent): void {
    const entry = job as Entry;
    entry.events.push(e);
    if (e.type === "done") entry.done = true;
    for (const fn of entry.listeners) fn(e);
  }

  subscribe(job: SeedJob, fn: (e: SeedEvent) => void): () => void {
    const entry = job as Entry;
    entry.listeners.add(fn);
    return () => entry.listeners.delete(fn);
  }
}
