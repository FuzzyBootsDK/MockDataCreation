import { useEffect, useRef, useState } from "react";
import type { FieldTypeInfo } from "@mockgen/core";

export function TypePicker({ value, types, onChange }: { value: string; types: FieldTypeInfo[]; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const groups = new Map<string, FieldTypeInfo[]>();
  for (const t of types) {
    if (q && !`${t.label} ${t.key} ${t.category}`.toLowerCase().includes(q)) continue;
    groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  }
  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="type-picker" ref={ref}>
      <button type="button" aria-label="Field type" onClick={() => setOpen((o) => !o)}>
        {types.find((t) => t.key === value)?.label ?? value}
      </button>
      {open && (
        <div className="popover">
          <input
            autoFocus
            placeholder="Search types…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          />
          {[...groups].map(([category, list]) => (
            <div key={category}>
              <h4>{category}</h4>
              {list.map((t) => (
                <button type="button" key={t.key} className={t.key === value ? "active" : ""} onClick={() => pick(t.key)}>
                  {t.label} <small>{t.key}</small>
                </button>
              ))}
            </div>
          ))}
          {groups.size === 0 && <p className="muted">No matching types</p>}
        </div>
      )}
    </div>
  );
}
