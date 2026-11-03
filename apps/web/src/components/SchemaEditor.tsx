import { useEffect, useMemo, useState } from "react";
import type { Dialect, Field, Format, Schema, ValidationIssue } from "@mockgen/core";
import { ApiError, api, downloadDraft, formatError, type NewSchema, type TypesInfo } from "../api.ts";
import { navigate } from "../App.tsx";
import { newId, slugify } from "../fieldTree.ts";
import { usePreview } from "../usePreview.ts";
import { FieldList, type EditorCtx } from "./FieldList.tsx";
import { DownloadDialog } from "./DownloadDialog.tsx";
import { MockPanel } from "./MockPanel.tsx";
import { Preview } from "./Preview.tsx";
import { SeedDialog } from "./SeedDialog.tsx";

type Draft = NewSchema & { id: string; fields: Field[] };

const DIALECT_LABELS: Record<Dialect, string> = { pg: "PostgreSQL", mssql: "SQL Server", sqlite: "SQLite" };

const emptyDraft = (): Draft => ({
  id: newId(),
  name: "",
  slug: "",
  locale: "en",
  defaultCount: 1000,
  seed: 1,
  mockEnabled: false,
  fields: [
    { name: "id", type: "rowNumber", options: {}, blankPercent: 0 },
    { name: "first_name", type: "person.firstName", options: {}, blankPercent: 0 },
    { name: "last_name", type: "person.lastName", options: {}, blankPercent: 0 },
    { name: "email", type: "internet.email", options: {}, blankPercent: 0 },
    { name: "gender", type: "person.sex", options: {}, blankPercent: 0 },
    { name: "ip_address", type: "internet.ipv4", options: {}, blankPercent: 0 },
  ],
});

export function SchemaEditor({ id, types }: { id: string | null; types: TypesInfo }) {
  const [draft, setDraft] = useState<Draft | null>(id ? null : emptyDraft());
  const [saved, setSaved] = useState<Schema | null>(null);
  const [others, setOthers] = useState<Schema[]>([]);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [dialog, setDialog] = useState<null | "download" | "seed">(null);
  const [format, setFormat] = useState<Format>("csv");
  const [dialect, setDialect] = useState<Dialect>("pg");
  const [ddl, setDdl] = useState(true);
  const [generating, setGenerating] = useState(false);
  const preview = usePreview(draft);

  useEffect(() => {
    api.schemas().then(
      (all) => {
        setOthers(all.filter((s) => s.id !== id));
        if (!id) return;
        const s = all.find((x) => x.id === id);
        if (s) {
          setDraft(s);
          setSaved(s);
        } else setMessage("Schema not found");
      },
      (e: unknown) => setMessage(formatError(e)),
    );
  }, [id]);

  const typeByKey = useMemo(() => new Map(types.types.map((t) => [t.key, t])), [types]);

  if (!draft) return <p className="muted">{message ?? "Loading…"}</p>;

  const issues = preview.issues.length ? preview.issues : saveIssues;
  const schemaIssues = issues.filter((i) => !i.path.startsWith("fields[") && !["name", "slug", "locale", "defaultCount", "seed"].includes(i.path));
  const issue = (path: string) => issues.find((i) => i.path === path)?.message;
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(draft);
  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaveIssues([]);
    setMessage(null);
  };

  const ctx: EditorCtx = {
    root: draft.fields,
    setFields: (fields) => update({ fields }),
    types,
    typeByKey,
    schemas: others,
    issues,
  };

  const save = async () => {
    try {
      const { id: draftId, ...body } = draft;
      const isNew = saved === null;
      const s = isNew ? await api.createSchema({ id: draftId, ...body }) : await api.updateSchema(draftId, body);
      setSaved(s);
      setDraft(s);
      setSaveIssues([]);
      setMessage("Saved");
      if (isNew) navigate(`#/schemas/${s.id}`);
    } catch (e) {
      if (e instanceof ApiError) setSaveIssues(e.issues);
      setMessage(formatError(e));
    }
  };

  const generate = async () => {
    const count = draft.defaultCount;
    if (count === undefined || !Number.isInteger(count) || count < 1 || count > types.maxRows) {
      setMessage(`Rows must be a whole number between 1 and ${types.maxRows}`);
      return;
    }
    setMessage(null);
    setGenerating(true);
    try {
      await downloadDraft({ schema: draft, format, dialect, ddl });
    } catch (e) {
      if (e instanceof ApiError) setSaveIssues(e.issues);
      setMessage(formatError(e));
    } finally {
      setGenerating(false);
    }
  };

  const toggleMock = async (enabled: boolean) => {
    if (!saved) return;
    try {
      const { id: savedId, ...body } = saved;
      const s = await api.updateSchema(savedId, { ...body, mockEnabled: enabled });
      setSaved(s);
      setDraft({ ...draft, mockEnabled: s.mockEnabled });
    } catch (e) {
      setMessage(formatError(e));
    }
  };
  const all = saved ? [...others, saved] : others;

  return (
    <div className="editor">
      <div className="toolbar">
        <h1>{draft.name || "New schema"}</h1>
        {message && <span className={message === "Saved" ? "muted" : "error"}>{message}</span>}
        <a href="#/">Back</a>
        <button type="button" onClick={save} disabled={!dirty}>
          Save
        </button>
      </div>

      <section className="panel">
        <div className="field-head" aria-hidden>
          <span />
          <span>Field Name</span>
          <span>Type</span>
          <span>Options</span>
          <span />
          <span />
        </div>
        <FieldList parentPath={[]} ctx={ctx} />
        {schemaIssues.map((i) => <p key={i.path + i.message} className="error">{i.message}</p>)}
      </section>

      <section className="panel generate-bar">
        <label>
          # Rows
          <input
            type="number"
            min={1}
            max={types.maxRows}
            value={draft.defaultCount}
            onChange={(e) => update({ defaultCount: Number(e.target.value) })}
          />
          {issue("defaultCount") && <small className="error">{issue("defaultCount")}</small>}
        </label>
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            {types.formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>
        {format === "sql" && (
          <>
            <label>
              Dialect
              <select value={dialect} onChange={(e) => setDialect(e.target.value as Dialect)}>
                {types.dialects.map((d) => <option key={d} value={d}>{DIALECT_LABELS[d]}</option>)}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={ddl} onChange={(e) => setDdl(e.target.checked)} /> Include CREATE TABLE
            </label>
          </>
        )}
        <div className="generate-actions">
          <button type="button" className="primary big" onClick={generate} disabled={generating}>
            {generating ? "Generating…" : "Generate Data"}
          </button>
          {saved && (
            <button type="button" disabled={dirty} title={dirty ? "Save first" : undefined} onClick={() => setDialog("download")}>
              More export options…
            </button>
          )}
        </div>
      </section>

      <Preview {...preview} />

      <section className="panel">
        <h3>Schema</h3>
        <div className="schema-settings">
          <label>
            Name
            <input
              value={draft.name}
              placeholder="Untitled"
              onChange={(e) => update({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })}
            />
            {issue("name") && <small className="error">{issue("name")}</small>}
          </label>
          <label>
            Slug
            <input
              value={draft.slug}
              placeholder="mock-data"
              onChange={(e) => {
                setSlugTouched(true);
                update({ slug: e.target.value });
              }}
            />
            {issue("slug") && <small className="error">{issue("slug")}</small>}
          </label>
          <label>
            Locale
            <select value={draft.locale} onChange={(e) => update({ locale: e.target.value })}>
              {types.locales.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            {issue("locale") && <small className="error">{issue("locale")}</small>}
          </label>
          <label>
            Seed
            <input type="number" min={0} value={draft.seed} onChange={(e) => update({ seed: Number(e.target.value) })} />
            {issue("seed") && <small className="error">{issue("seed")}</small>}
          </label>
        </div>
        <p className="muted">Save the schema to reuse it, seed a database or serve it as a mock API.</p>
      </section>

      {saved && (
        <div className="extras">
          <section className="panel stack">
            <h3>Seed a database</h3>
            <p className="muted">Insert rows straight into PostgreSQL, SQL Server or SQLite.</p>
            <button type="button" disabled={dirty} onClick={() => setDialog("seed")}>Seed database…</button>
          </section>
          <MockPanel schema={saved} onToggle={toggleMock} />
        </div>
      )}
      {saved && dialog === "download" && <DownloadDialog schema={saved} all={all} types={types} onClose={() => setDialog(null)} />}
      {saved && dialog === "seed" && <SeedDialog schema={saved} all={all} onClose={() => setDialog(null)} />}
    </div>
  );
}
