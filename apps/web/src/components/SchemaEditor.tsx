import { useEffect, useMemo, useState } from "react";
import type { Field, Schema, ValidationIssue } from "@mockgen/core";
import { ApiError, api, formatError, type NewSchema, type TypesInfo } from "../api.ts";
import { navigate } from "../App.tsx";
import { slugify } from "../fieldTree.ts";
import { usePreview } from "../usePreview.ts";
import { FieldList, type EditorCtx } from "./FieldList.tsx";
import { DownloadDialog } from "./DownloadDialog.tsx";
import { MockPanel } from "./MockPanel.tsx";
import { Preview } from "./Preview.tsx";
import { SeedDialog } from "./SeedDialog.tsx";

type Draft = NewSchema & { id: string; fields: Field[] };

const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(),
  name: "",
  slug: "",
  locale: "en",
  defaultCount: 100,
  seed: 1,
  mockEnabled: false,
  fields: [
    { name: "id", type: "rowNumber", options: {}, blankPercent: 0 },
    { name: "first_name", type: "person.firstName", options: {}, blankPercent: 0 },
    { name: "last_name", type: "person.lastName", options: {}, blankPercent: 0 },
    {
      name: "email",
      type: "formula",
      options: { expression: 'lower(first_name) + "." + lower(last_name) + "@example.com"' },
      blankPercent: 0,
    },
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
    <div>
      <div className="toolbar">
        <h1>{draft.name || "New schema"}</h1>
        {message && <span className={message === "Saved" ? "muted" : "error"}>{message}</span>}
        <a href="#/">Back</a>
        <button type="button" className="primary" onClick={save} disabled={!dirty}>
          Save
        </button>
      </div>
      <div className="editor">
        <div>
          <section className="panel">
            <div className="schema-settings">
              <label>
                Name
                <input
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })}
                />
                {issue("name") && <small className="error">{issue("name")}</small>}
              </label>
              <label>
                Slug
                <input
                  value={draft.slug}
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
                Default rows
                <input type="number" min={1} value={draft.defaultCount} onChange={(e) => update({ defaultCount: Number(e.target.value) })} />
                {issue("defaultCount") && <small className="error">{issue("defaultCount")}</small>}
              </label>
              <label>
                Seed
                <input type="number" min={0} value={draft.seed} onChange={(e) => update({ seed: Number(e.target.value) })} />
                {issue("seed") && <small className="error">{issue("seed")}</small>}
              </label>
            </div>
            {schemaIssues.map((i) => <p key={i.path + i.message} className="error">{i.message}</p>)}
          </section>
          <section className="panel">
            <h3>Fields</h3>
            <FieldList parentPath={[]} ctx={ctx} />
          </section>
          <Preview {...preview} />
        </div>
        <aside>
          <section className="panel stack">
            <h3>Export</h3>
            {dirty && <p className="muted">Save the schema to download, seed or serve it.</p>}
            <button type="button" disabled={dirty} onClick={() => setDialog("download")}>Download…</button>
            <button type="button" disabled={dirty} onClick={() => setDialog("seed")}>Seed database…</button>
          </section>
          {saved && <MockPanel schema={saved} onToggle={toggleMock} />}
        </aside>
        {saved && dialog === "download" && <DownloadDialog schema={saved} all={all} types={types} onClose={() => setDialog(null)} />}
        {saved && dialog === "seed" && <SeedDialog schema={saved} all={all} onClose={() => setDialog(null)} />}
      </div>
    </div>
  );
}
