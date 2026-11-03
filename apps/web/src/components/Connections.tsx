import { useCallback, useEffect, useState } from "react";
import type { ValidationIssue } from "@mockgen/core";
import { ApiError, api, formatError, type Connection, type ConnectionKind } from "../api.ts";

const blank = (kind: ConnectionKind): Partial<Connection> =>
  kind === "sqlite"
    ? { name: "", kind, file: "seed.db" }
    : { name: "", kind, host: "localhost", port: kind === "pg" ? 5432 : 1433, database: "", user: "", password: "" };

export function Connections() {
  const [list, setList] = useState<Connection[]>([]);
  const [edit, setEdit] = useState<Partial<Connection>>(blank("pg"));
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => api.connections().then(setList, (e: unknown) => setMessage(formatError(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  const issue = (path: string) => issues.find((i) => i.path === path)?.message;
  const set = (patch: Partial<Connection>) => setEdit({ ...edit, ...patch });

  const save = async () => {
    try {
      const c = await api.saveConnection(edit);
      setEdit(c);
      setIssues([]);
      setMessage("Saved");
      await load();
    } catch (e) {
      setIssues(e instanceof ApiError ? e.issues : []);
      setMessage(formatError(e));
    }
  };

  const remove = async () => {
    if (!edit.id || !confirm(`Delete "${edit.name}"?`)) return;
    await api.deleteConnection(edit.id).catch((e: unknown) => setMessage(formatError(e)));
    setEdit(blank("pg"));
    await load();
  };

  const test = async () => {
    if (!edit.id) return;
    const r = await api.testConnection(edit.id).catch((e: unknown) => ({ ok: false, error: formatError(e) }));
    setMessage(r.ok ? "Connection works" : `Connection failed: ${r.error}`);
  };

  const text = (key: keyof Connection, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={edit[key] === undefined ? "" : String(edit[key])}
        onChange={(e) => set({ [key]: type === "number" ? Number(e.target.value) : e.target.value } as Partial<Connection>)}
      />
      {issue(key) && <small className="error">{issue(key)}</small>}
    </label>
  );

  return (
    <div>
      <div className="toolbar">
        <h1>Connections</h1>
        <button type="button" onClick={() => { setEdit(blank("pg")); setIssues([]); setMessage(null); }}>New connection</button>
      </div>
      <div className="connections">
        <ul className="panel">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className={c.id === edit.id ? "active" : ""} onClick={() => { setEdit(c); setIssues([]); setMessage(null); }}>
                {c.name} <span className="muted">({c.kind})</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="muted">No connections yet</li>}
        </ul>
        <section className="panel stack">
          <label>
            Kind
            <select value={edit.kind} disabled={!!edit.id} onChange={(e) => setEdit({ ...blank(e.target.value as ConnectionKind), name: edit.name })}>
              <option value="pg">PostgreSQL</option>
              <option value="mssql">SQL Server</option>
              <option value="sqlite">SQLite</option>
            </select>
          </label>
          {text("name", "Name")}
          {edit.kind === "sqlite" ? (
            text("file", "File (relative to the data directory)")
          ) : (
            <>
              {text("host", "Host")}
              {text("port", "Port", "number")}
              {text("database", "Database")}
              {text("user", "User")}
              {text("password", "Password", "password")}
              {edit.kind === "pg" && (
                <label className="check">
                  <input type="checkbox" checked={!!edit.ssl} onChange={(e) => set({ ssl: e.target.checked })} /> Use SSL
                </label>
              )}
              {edit.kind === "mssql" && (
                <>
                  <label className="check">
                    <input type="checkbox" checked={edit.encrypt ?? true} onChange={(e) => set({ encrypt: e.target.checked })} /> Encrypt
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={edit.trustServerCertificate ?? true}
                      onChange={(e) => set({ trustServerCertificate: e.target.checked })}
                    />{" "}
                    Trust server certificate
                  </label>
                </>
              )}
              <p className="muted">
                Passwords are stored in plain text in mockgen's local database. To keep one out of it, enter <code>${"{ENV_VAR}"}</code> and set
                that environment variable on the container.
              </p>
            </>
          )}
          {message && <p className={message === "Saved" || message === "Connection works" ? "muted" : "error"}>{message}</p>}
          <div className="actions">
            {edit.id && <button type="button" onClick={remove}>Delete</button>}
            {edit.id && <button type="button" onClick={test}>Test</button>}
            <button type="button" className="primary" onClick={save}>Save</button>
          </div>
        </section>
      </div>
    </div>
  );
}
