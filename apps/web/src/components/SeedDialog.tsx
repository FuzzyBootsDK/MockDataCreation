import { useEffect, useState } from "react";
import type { Schema } from "@mockgen/core";
import { api, formatError, type Connection, type SeedEvent, type SeedMode } from "../api.ts";
import { referencedIds } from "../fieldTree.ts";
import { Dialog } from "./Dialog.tsx";

type Status = "idle" | "running" | "done" | "failed";

export function SeedDialog({ schema, all, onClose }: { schema: Schema; all: Schema[]; onClose: () => void }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [mode, setMode] = useState<SeedMode>("create");
  const [count, setCount] = useState(schema.defaultCount);
  const [progress, setProgress] = useState<Record<string, { inserted: number; total: number }>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const deps = referencedIds(schema, all).map((id) => all.find((s) => s.id === id)!).filter(Boolean);

  useEffect(() => {
    api.connections().then(
      (cs) => {
        setConnections(cs);
        if (cs[0]) setConnectionId(cs[0].id);
      },
      (e: unknown) => setError(formatError(e)),
    );
  }, []);

  const start = async () => {
    setError(null);
    setProgress({});
    setStatus("running");
    try {
      const { jobId } = await api.startSeed({ connectionId, schemas: [{ id: schema.id, count }], mode });
      const es = new EventSource(`/api/seed/${jobId}/events`);
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as SeedEvent;
        if (e.type === "start") setProgress(Object.fromEntries(e.tables.map((t) => [t.table, { inserted: 0, total: t.total }])));
        if (e.type === "progress") setProgress((p) => ({ ...p, [e.table]: { inserted: e.inserted, total: e.total } }));
        if (e.type === "error") setError(`${e.table ? `Table ${e.table}, batch ${e.batch}: ` : ""}${e.message}`);
        if (e.type === "done") {
          es.close();
          setStatus(e.ok ? "done" : "failed");
        }
      };
      es.onerror = () => {
        es.close();
        setStatus((s) => (s === "running" ? "failed" : s));
        setError((err) => err ?? "Lost connection to the server");
      };
    } catch (e) {
      setStatus("failed");
      setError(formatError(e));
    }
  };

  return (
    <Dialog title={`Seed ${schema.name}`} onClose={onClose}>
      {connections && connections.length === 0 ? (
        <p>
          No connections yet. <a href="#/connections" onClick={onClose}>Add a connection</a> first.
        </p>
      ) : (
        <div className="stack">
          <label>
            Connection
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              {(connections ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
            </select>
          </label>
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as SeedMode)}>
              <option value="create">Create tables if missing, then insert</option>
              <option value="append">Insert into existing tables</option>
              <option value="truncate">Delete existing rows, then insert</option>
            </select>
          </label>
          <label>
            Rows for {schema.slug}
            <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          {deps.map((d) => (
            <label key={d.id}>
              Rows for {d.slug} (referenced, fixed)
              <input type="number" value={d.defaultCount} disabled />
            </label>
          ))}
          {Object.entries(progress).map(([table, p]) => (
            <label key={table}>
              {table}: {p.inserted} / {p.total}
              <progress value={p.inserted} max={Math.max(p.total, 1)} />
            </label>
          ))}
          {status === "done" && <p>Done.</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={onClose}>Close</button>
        <button type="button" className="primary" onClick={start} disabled={!connectionId || status === "running"}>
          {status === "running" ? "Seeding…" : "Start"}
        </button>
      </div>
    </Dialog>
  );
}
