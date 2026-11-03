import type { FieldTypeInfo, Schema } from "@mockgen/core";

interface JsonProp {
  type?: string;
  enum?: string[];
  default?: unknown;
}

type Options = Record<string, unknown>;
type ListValue = { value: string; weight?: number };

function ListEditor({ values, onChange }: { values: ListValue[]; onChange: (v: ListValue[]) => void }) {
  const set = (i: number, patch: Partial<ListValue>) => onChange(values.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="list-editor">
      {values.map((v, i) => (
        <div key={i}>
          <input aria-label="List value" value={v.value} onChange={(e) => set(i, { value: e.target.value })} />
          <input
            aria-label="Weight"
            type="number"
            min={0}
            step="any"
            value={v.weight ?? 1}
            onChange={(e) => set(i, { weight: Number(e.target.value) })}
          />
          <button type="button" className="icon" aria-label="Remove value" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...values, { value: "", weight: 1 }])}>
        + Add value
      </button>
    </div>
  );
}

function ReferenceOptions({ options, onChange, errors, schemas }: {
  options: Options;
  onChange: (o: Options) => void;
  errors: Record<string, string>;
  schemas: Schema[];
}) {
  const target = schemas.find((s) => s.id === options.schemaId);
  const fields = (target?.fields ?? []).filter((f) => f.type !== "object" && f.type !== "array");
  return (
    <div className="options">
      <label className="opt">
        <span>schema</span>
        <select value={String(options.schemaId ?? "")} onChange={(e) => onChange({ schemaId: e.target.value, fieldName: "" })}>
          <option value="">Choose…</option>
          {schemas.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {errors["options.schemaId"] && <small className="error">{errors["options.schemaId"]}</small>}
      </label>
      <label className="opt">
        <span>field</span>
        <select value={String(options.fieldName ?? "")} onChange={(e) => onChange({ ...options, fieldName: e.target.value })}>
          <option value="">Choose…</option>
          {fields.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
        {errors["options.fieldName"] && <small className="error">{errors["options.fieldName"]}</small>}
      </label>
      {!schemas.length && <span className="muted">Save another schema first to reference it.</span>}
    </div>
  );
}

export function OptionsEditor({ type, options, onChange, errors, schemas }: {
  type: FieldTypeInfo;
  options: Options;
  onChange: (o: Options) => void;
  errors: Record<string, string>;
  schemas: Schema[];
}) {
  if (type.kind === "reference") return <ReferenceOptions options={options} onChange={onChange} errors={errors} schemas={schemas} />;

  const props = (type.optionsSchema as { properties?: Record<string, JsonProp> }).properties ?? {};
  const entries = Object.entries(props);
  if (!entries.length) return <span className="muted">—</span>;

  const set = (key: string, value: unknown) => {
    const next = { ...options };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const input = (key: string, p: JsonProp) => {
    const v = options[key];
    if (p.enum) {
      return (
        <select value={String(v ?? p.default ?? "")} onChange={(e) => set(key, e.target.value)}>
          {p.enum.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (p.type === "boolean") {
      return <input type="checkbox" checked={Boolean(v ?? p.default)} onChange={(e) => set(key, e.target.checked)} />;
    }
    if (p.type === "number" || p.type === "integer") {
      return (
        <input
          type="number"
          step={p.type === "integer" ? 1 : "any"}
          value={v === undefined ? "" : String(v)}
          placeholder={p.default === undefined ? "" : String(p.default)}
          onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    }
    if (p.type === "array") {
      return <ListEditor values={(v as ListValue[] | undefined) ?? []} onChange={(list) => set(key, list)} />;
    }
    return (
      <input
        value={v === undefined ? "" : String(v)}
        placeholder={p.default === undefined ? "" : String(p.default)}
        onChange={(e) => set(key, e.target.value)}
      />
    );
  };

  return (
    <div className="options">
      {entries.map(([key, p]) => (
        <label key={key} className={key === "expression" ? "opt wide" : "opt"}>
          <span>{key}</span>
          {input(key, p)}
          {errors[`options.${key}`] && <small className="error">{errors[`options.${key}`]}</small>}
        </label>
      ))}
    </div>
  );
}
