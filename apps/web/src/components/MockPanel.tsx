import type { Schema } from "@mockgen/core";

export function MockPanel({ schema, onToggle }: { schema: Schema; onToggle: (enabled: boolean) => void }) {
  const base = `${location.origin}/mock/${schema.slug}`;
  const hasId = schema.fields.some((f) => f.name === "id" && f.type === "rowNumber");
  const examples = [
    `curl "${base}?page=1&pageSize=20"`,
    hasId ? `curl "${base}/1"` : null,
    `curl -X POST "${base}" -H "content-type: application/json" -d '{}'`,
  ].filter(Boolean);
  return (
    <section className="panel stack">
      <h3>Mock API</h3>
      <label className="check">
        <input type="checkbox" checked={schema.mockEnabled} onChange={(e) => onToggle(e.target.checked)} />
        Serve this schema at <code>/mock/{schema.slug}</code>
      </label>
      {schema.mockEnabled && (
        <>
          <pre>{examples.join("\n")}</pre>
          <p className="muted">
            Data is stable for the schema's seed. Writes return realistic responses but are not stored.
          </p>
          {!hasId && <p className="muted">Add a top-level <code>id</code> field of type Row Number to enable <code>/{"{id}"}</code> requests.</p>}
        </>
      )}
    </section>
  );
}
