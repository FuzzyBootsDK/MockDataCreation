import { useCallback, useEffect, useRef, useState } from "react";
import type { Schema } from "@mockgen/core";
import { api, formatError, saveBlob, type NewSchema } from "../api.ts";

export function SchemaList() {
  const [schemas, setSchemas] = useState<Schema[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.schemas().then(setSchemas, (e: unknown) => setError(formatError(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().then(load, (e: unknown) => setError(formatError(e)));
  };

  const duplicate = (s: Schema) =>
    run(() => {
      const { id: _id, ...rest } = s;
      const slugs = new Set((schemas ?? []).map((x) => x.slug));
      let slug = `${s.slug}-copy`;
      for (let n = 2; slugs.has(slug); n++) slug = `${s.slug}-copy-${n}`;
      return api.createSchema({ ...rest, name: `${s.name} (copy)`, slug });
    });

  const remove = (s: Schema) => {
    if (confirm(`Delete "${s.name}"?`)) run(() => api.deleteSchema(s.id));
  };

  const importFile = (file: File) =>
    run(async () => {
      return api.createSchema(JSON.parse(await file.text()) as NewSchema & { id?: string });
    });

  return (
    <div>
      <div className="toolbar">
        <h1>Schemas</h1>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importFile(f);
          }} />
        <button type="button" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <a className="button primary" href="#/schemas/new" role="link">New schema</a>
      </div>
      {error && <p className="error">{error}</p>}
      {schemas && schemas.length === 0 && (
        <div className="empty-state">
          <p>No schemas yet. Create one to start generating data.</p>
          <a className="button primary" href="#/schemas/new" role="link">Create your first schema</a>
        </div>
      )}
      {schemas && schemas.length > 0 && (
        <table className="list">
          <thead>
            <tr><th>Name</th><th>Slug</th><th>Fields</th><th>Rows</th><th /></tr>
          </thead>
          <tbody>
            {schemas.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={`#/schemas/${s.id}`}>{s.name}</a> {s.mockEnabled && <span className="badge">mock</span>}
                </td>
                <td><code>{s.slug}</code></td>
                <td>{s.fields.length}</td>
                <td>{s.defaultCount}</td>
                <td className="toolbar">
                  <button type="button" onClick={() => duplicate(s)}>Duplicate</button>
                  <button type="button" onClick={() => saveBlob(new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }), `${s.slug}.schema.json`)}>
                    Export JSON
                  </button>
                  <button type="button" onClick={() => remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
