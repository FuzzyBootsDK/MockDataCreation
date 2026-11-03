import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldTypeInfo } from "@mockgen/core";

const ALL = "All";

export function TypePicker({ value, types, onChange }: { value: string; types: FieldTypeInfo[]; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="type-picker">
      <button type="button" aria-label="Field type" onClick={() => setOpen(true)}>
        {types.find((t) => t.key === value)?.label ?? value}
      </button>
      {open && (
        <TypeDialog
          value={value}
          types={types}
          onPick={(key) => {
            onChange(key);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function TypeDialog({ value, types, onPick, onClose }: {
  value: string;
  types: FieldTypeInfo[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of types) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [types]);

  const q = query.trim().toLowerCase();
  const shown = types
    .filter((t) => (q ? `${t.label} ${t.key} ${t.category}`.toLowerCase().includes(q) : category === ALL || t.category === category))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <dialog
      ref={ref}
      className="type-dialog"
      aria-label="Choose a Type"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      <header>
        <h2>Choose a Type</h2>
        <input
          type="search"
          autoFocus
          placeholder="Find Type…"
          aria-label="Find type"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="icon" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </header>
      <nav className="type-categories" aria-label="Type categories">
        {[[ALL, types.length] as const, ...categories].map(([name, count]) => (
          <button
            type="button"
            key={name}
            className={!q && category === name ? "active" : ""}
            onClick={() => {
              setCategory(name);
              setQuery("");
            }}
          >
            {name} <span>({count})</span>
          </button>
        ))}
      </nav>
      <div className="type-grid">
        {shown.map((t) => (
          <button type="button" key={t.key} className={t.key === value ? "type-card active" : "type-card"} onClick={() => onPick(t.key)}>
            <strong>{t.label}</strong>
            {t.examples.length ? (
              t.examples.map((ex, i) => <span key={i}>{ex}</span>)
            ) : (
              <em>{t.description ?? "Set the options after choosing it"}</em>
            )}
          </button>
        ))}
        {shown.length === 0 && <p className="muted">No types match “{query}”.</p>}
      </div>
    </dialog>
  );
}
