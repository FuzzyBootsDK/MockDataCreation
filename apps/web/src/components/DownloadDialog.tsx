import { useState } from "react";
import type { Dialect, Format, Schema } from "@mockgen/core";
import { downloadMulti, formatError, generateUrl, type TypesInfo } from "../api.ts";
import { referencedIds } from "../fieldTree.ts";
import { Dialog } from "./Dialog.tsx";

export function DownloadDialog({ schema, all, types, onClose }: { schema: Schema; all: Schema[]; types: TypesInfo; onClose: () => void }) {
  const refs = referencedIds(schema, all);
  const [format, setFormat] = useState<Format>("csv");
  const [dialect, setDialect] = useState<Dialect>("pg");
  const [count, setCount] = useState(schema.defaultCount);
  const [seed, setSeed] = useState(schema.seed);
  const [ddl, setDdl] = useState(true);
  const [withRefs, setWithRefs] = useState(refs.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setError(null);
    if (!Number.isInteger(count) || count < 0 || count > types.maxRows) {
      setError(`Rows must be a whole number between 0 and ${types.maxRows}`);
      return;
    }
    if (!Number.isInteger(seed) || seed < 0) {
      setError("Seed must be a whole number, 0 or greater");
      return;
    }
    if (!withRefs) {
      const a = document.createElement("a");
      a.href = generateUrl(schema.id, { format, dialect, count, seed, ddl });
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      onClose();
      return;
    }
    setBusy(true);
    try {
      await downloadMulti({ schemaIds: [schema.id], counts: { [schema.id]: count }, format, dialect, seed, ddl });
      onClose();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const refNames = refs.map((id) => all.find((s) => s.id === id)?.name ?? id).join(", ");

  return (
    <Dialog title={`Download ${schema.name}`} onClose={onClose}>
      <div className="stack">
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            {types.formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>
        {format === "sql" && (
          <>
            <label>
              SQL dialect
              <select value={dialect} onChange={(e) => setDialect(e.target.value as Dialect)}>
                {types.dialects.map((d) => <option key={d} value={d}>{{ pg: "PostgreSQL", mssql: "SQL Server", sqlite: "SQLite" }[d]}</option>)}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={ddl} onChange={(e) => setDdl(e.target.checked)} /> Include CREATE TABLE
            </label>
          </>
        )}
        <label>
          Rows
          <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <label>
          Seed
          <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>
        {refs.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={withRefs} onChange={(e) => setWithRefs(e.target.checked)} />
            Include referenced schemas ({refNames}) {format === "sql" ? "in one script" : "as a zip"}
          </label>
        )}
        {refs.length > 0 && !withRefs && (
          <p className="muted">Reference values only match the other schemas if you export them with the same seed and their default row counts.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={download} disabled={busy}>Download</button>
      </div>
    </Dialog>
  );
}
