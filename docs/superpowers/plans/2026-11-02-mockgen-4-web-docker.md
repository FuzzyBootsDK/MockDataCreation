# mockgen Part 4: Web UI and Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React UI (schema list, schema editor with live preview, download, mock and seed controls, connection management) and package the whole app as one Docker image with a compose file.

**Architecture:** `apps/web` is a Vite + React SPA with hash routing. It talks only to the server's HTTP API and imports **types only** from `@mockgen/core` (never values, so faker is not bundled). Pure field-tree helpers live in `src/fieldTree.ts` and are unit-tested; the UI is covered by one Playwright smoke test against the real server. The Docker image runs `node apps/server/src/main.ts` and serves `apps/web/dist`.

**Tech Stack:** React 19.3.1, Vite 8.3.5, @vitejs/plugin-react 6.2.1, Vitest 5, Playwright 1.64.1, Docker (node:24-bookworm-slim), pnpm 11.21.0.

**Spec:** `docs/superpowers/specs/2026-11-02-mockgen-design.md` (§5.1, §8)

**Plan series:** Part 1 Core → Part 2 Server → Part 3 Seeding → **Part 4 Web UI & Docker (this)**. Requires Parts 1–3 complete.

## Global Constraints

- `apps/web` may only use `import type` from `@mockgen/core`. Any value it needs (types catalog, locales, formats, dialects) comes from `GET /api/types`.
- Hash routes: `#/` (schema list), `#/schemas/new`, `#/schemas/<id>`, `#/connections`.
- Live preview: `POST /api/preview` 300 ms after the last edit; 10 rows.
- Validation messages are shown next to the input whose path they belong to (`fields[0].children[1].options.min` → that nested field's `min` option).
- Connection page must state that passwords are stored in plain text and that `${ENV_VAR}` can be used instead.
- Docker: one image, port `8080`, volume `/data`, non-root `node` user, health check on `/health`. Compose adds `postgres` (17-alpine) and `mssql` (2022-latest) under profile `dbs`.
- Accessible labels: every input has a visible label or `aria-label` (the Playwright test relies on `Name`, `Slug`, `Field name`, `Serve this schema…`).

## File Structure

```
apps/web/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts, index.html
  src/main.tsx                    React root
  src/App.tsx                     header + hash router
  src/api.ts                      typed fetch client, ApiError, formatError, generateUrl, downloadMulti, saveBlob
  src/fieldTree.ts                pure helpers over nested Field[] (+ slugify, referenced ids)
  src/fieldTree.test.ts
  src/usePreview.ts               debounced preview hook
  src/styles.css
  src/components/Dialog.tsx
  src/components/SchemaList.tsx
  src/components/SchemaEditor.tsx
  src/components/FieldList.tsx    recursive list + drag to reorder
  src/components/FieldRow.tsx
  src/components/TypePicker.tsx
  src/components/OptionsEditor.tsx  JSON-Schema-driven option inputs, custom list, reference pickers
  src/components/Preview.tsx
  src/components/DownloadDialog.tsx
  src/components/MockPanel.tsx
  src/components/SeedDialog.tsx
  src/components/Connections.tsx
  e2e/smoke.spec.ts
Dockerfile, .dockerignore, docker-compose.yml, README.md
```

---

### Task 1: Web scaffold, API client and field-tree helpers

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/api.ts`, `apps/web/src/fieldTree.ts`, `apps/web/src/usePreview.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (shell), `apps/web/src/styles.css`, `apps/web/src/components/Dialog.tsx`
- Modify: root `package.json` (scripts), `.gitignore`
- Test: `apps/web/src/fieldTree.test.ts`

**Interfaces:**
- Consumes (types only): `Field`, `Schema`, `SchemaInput`, `Row`, `FieldTypeInfo`, `ValidationIssue`, `Format`, `Dialect` from `@mockgen/core`.
- Produces:
  - `api.ts`: `interface TypesInfo { types: FieldTypeInfo[]; locales: string[]; formats: Format[]; dialects: Dialect[]; helpers: string[] }`; `type ConnectionKind`; `interface Connection`; `type SeedMode`; `type SeedEvent`; `class ApiError extends Error { status: number; issues: ValidationIssue[] }`; `formatError(e: unknown): string`; `api` object (`types, schemas, createSchema, updateSchema, deleteSchema, preview, connections, saveConnection, deleteConnection, testConnection, startSeed`); `generateUrl(id, params): string`; `downloadMulti(body): Promise<void>`; `saveBlob(blob, filename): void`
  - `fieldTree.ts`: `type FieldPath = number[]`; `getAt`, `updateAt`, `removeAt`, `appendTo`, `moveWithin`, `newField`, `pathString`, `issuesAt`, `slugify`, `referencedIds(schema, all): string[]` (transitive, parent-first, excluding the schema itself)
  - `usePreview(draft: unknown): { rows: Row[]; warnings: number; issues: ValidationIssue[]; error: string | null; loading: boolean }`
  - `Dialog({ title, onClose, children })`
  - `App` with `navigate(hash: string): void` exported from `App.tsx`

- [ ] **Step 1: Create the package and config**

`apps/web/package.json`:
```json
{
  "name": "@mockgen/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc -p .",
    "e2e": "vite build && node -e \"require('fs').rmSync('.e2e-data',{recursive:true,force:true})\" && playwright test"
  },
  "dependencies": {
    "react": "19.3.1",
    "react-dom": "19.3.1"
  },
  "devDependencies": {
    "@mockgen/core": "workspace:*",
    "@playwright/test": "1.64.1",
    "@types/node": "24.19.2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "6.2.1",
    "typescript": "7.0.2",
    "vite": "8.3.5",
    "vitest": "5.0.5"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2023", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": server, "/mock": server, "/docs": server, "/health": server },
  },
});
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mockgen</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Root `package.json` `scripts` becomes:
```json
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "build": "pnpm --filter @mockgen/web build",
    "start": "pnpm --filter @mockgen/server start"
  }
```

Append to `.gitignore`:
```
.e2e-data/
```

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 2: Write the failing field-tree test**

`apps/web/src/fieldTree.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import type { Field, Schema } from "@mockgen/core";
import {
  appendTo, getAt, issuesAt, moveWithin, newField, pathString, referencedIds, removeAt, slugify, updateAt,
} from "./fieldTree.ts";

const f = (name: string, children?: Field[]): Field => ({ name, type: children ? "object" : "uuid", options: {}, blankPercent: 0, children });
const tree: Field[] = [f("a"), f("obj", [f("x"), f("y", [f("deep")])]), f("b")];

describe("fieldTree", () => {
  test("getAt walks children", () => {
    expect(getAt(tree, [1, 1, 0])?.name).toBe("deep");
    expect(getAt(tree, [9])).toBeUndefined();
  });

  test("updateAt is immutable", () => {
    const next = updateAt(tree, [1, 0], { name: "renamed" });
    expect(getAt(next, [1, 0])?.name).toBe("renamed");
    expect(getAt(tree, [1, 0])?.name).toBe("x");
    expect(next[0]).toBe(tree[0]);
  });

  test("removeAt, appendTo, moveWithin", () => {
    expect(removeAt(tree, [1, 1])[1]!.children!.map((c) => c.name)).toEqual(["x"]);
    expect(appendTo(tree, [1], f("z"))[1]!.children!.map((c) => c.name)).toEqual(["x", "y", "z"]);
    expect(appendTo(tree, [], f("c")).map((c) => c.name)).toEqual(["a", "obj", "b", "c"]);
    expect(moveWithin(tree, [], 2, 0).map((c) => c.name)).toEqual(["b", "a", "obj"]);
    expect(moveWithin(tree, [1], 0, 1)[1]!.children!.map((c) => c.name)).toEqual(["y", "x"]);
  });

  test("newField picks a unique name", () => {
    expect(newField([f("field_1"), f("field_2")]).name).toBe("field_3");
    expect(newField([f("field_3")]).name).toBe("field_1");
  });

  test("pathString and issuesAt", () => {
    expect(pathString([1, 0])).toBe("fields[1].children[0]");
    const issues = [
      { path: "fields[1].name", message: "dup" },
      { path: "fields[1].children", message: "need children" },
      { path: "fields[1].children[0].type", message: "nested" },
      { path: "fields[1].options.min", message: "min" },
      { path: "fields[10].name", message: "other" },
    ];
    expect(issuesAt(issues, [1])).toEqual({ name: "dup", children: "need children", "options.min": "min" });
    expect(issuesAt(issues, [1, 0])).toEqual({ type: "nested" });
  });

  test("slugify", () => {
    expect(slugify("  Order Lines (DK) ")).toBe("order-lines-dk");
    expect(slugify("Kunder æøå")).toBe("kunder-aeoa");
  });

  test("referencedIds is transitive and parent-first", () => {
    const s = (id: string, refs: string[]): Schema => ({
      id, name: id, slug: id, locale: "en", defaultCount: 1, seed: 1, mockEnabled: false,
      fields: refs.map((r, i) => ({ name: `r${i}`, type: "reference", options: { schemaId: r, fieldName: "id" }, blankPercent: 0 })),
    });
    const all = [s("orders", ["customers"]), s("customers", ["regions"]), s("regions", [])];
    expect(referencedIds(all[0]!, all)).toEqual(["regions", "customers"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mockgen/web test`
Expected: FAIL, cannot resolve `./fieldTree.ts`.

- [ ] **Step 4: Implement fieldTree**

`apps/web/src/fieldTree.ts`:
```ts
import type { Field, Schema, ValidationIssue } from "@mockgen/core";

export type FieldPath = number[];

function mapList(fields: Field[], parent: FieldPath, fn: (list: Field[]) => Field[]): Field[] {
  if (parent.length === 0) return fn(fields);
  const [head, ...rest] = parent;
  return fields.map((f, i) => (i === head ? { ...f, children: mapList(f.children ?? [], rest, fn) } : f));
}

export function getAt(fields: Field[], path: FieldPath): Field | undefined {
  let list = fields;
  let found: Field | undefined;
  for (const i of path) {
    found = list[i];
    if (!found) return undefined;
    list = found.children ?? [];
  }
  return found;
}

export function updateAt(fields: Field[], path: FieldPath, patch: Partial<Field>): Field[] {
  const index = path.at(-1)!;
  return mapList(fields, path.slice(0, -1), (list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
}

export function removeAt(fields: Field[], path: FieldPath): Field[] {
  const index = path.at(-1)!;
  return mapList(fields, path.slice(0, -1), (list) => list.filter((_, i) => i !== index));
}

export function appendTo(fields: Field[], parent: FieldPath, field: Field): Field[] {
  return mapList(fields, parent, (list) => [...list, field]);
}

export function moveWithin(fields: Field[], parent: FieldPath, from: number, to: number): Field[] {
  return mapList(fields, parent, (list) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  });
}

export function newField(siblings: Field[]): Field {
  let n = 1;
  while (siblings.some((f) => f.name === `field_${n}`)) n++;
  return { name: `field_${n}`, type: "person.firstName", options: {}, blankPercent: 0 };
}

export function pathString(path: FieldPath): string {
  return path.map((i, depth) => `${depth === 0 ? "fields" : ".children"}[${i}]`).join("");
}

// Issues for one field, keyed by the rest of the path ("name", "options.min", "children").
export function issuesAt(issues: ValidationIssue[], path: FieldPath): Record<string, string> {
  const prefix = `${pathString(path)}.`;
  const out: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue.path.startsWith(prefix)) continue;
    const key = issue.path.slice(prefix.length);
    if (!key.startsWith("children[")) out[key] ??= issue.message;
  }
  return out;
}

const DANISH: Record<string, string> = { æ: "ae", ø: "o", å: "a" };

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[æøå]/g, (c) => DANISH[c]!)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function directRefs(fields: Field[], out: string[] = []): string[] {
  for (const f of fields) {
    const id = f.options.schemaId;
    if (f.type === "reference" && typeof id === "string" && !out.includes(id)) out.push(id);
    if (f.children) directRefs(f.children, out);
  }
  return out;
}

export function referencedIds(schema: Schema, all: Schema[]): string[] {
  const out: string[] = [];
  const visit = (s: Schema) => {
    for (const id of directRefs(s.fields)) {
      const dep = all.find((x) => x.id === id);
      if (!dep || out.includes(id) || id === schema.id) continue;
      visit(dep);
      out.push(id);
    }
  };
  visit(schema);
  return out;
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @mockgen/web test`
Expected: PASS.

- [ ] **Step 6: Implement the API client, preview hook and dialog**

`apps/web/src/api.ts`:
```ts
import type { Dialect, FieldTypeInfo, Format, Row, Schema, SchemaInput, ValidationIssue } from "@mockgen/core";

export interface TypesInfo {
  types: FieldTypeInfo[];
  locales: string[];
  formats: Format[];
  dialects: Dialect[];
  helpers: string[];
}

export type ConnectionKind = "pg" | "mssql" | "sqlite";

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  file?: string;
}

export type SeedMode = "create" | "append" | "truncate";

export type SeedEvent =
  | { type: "start"; tables: { table: string; total: number }[] }
  | { type: "progress"; table: string; inserted: number; total: number }
  | { type: "table-done"; table: string; inserted: number }
  | { type: "error"; table: string; batch: number; message: string }
  | { type: "done"; ok: boolean; warnings: number };

export type NewSchema = Omit<SchemaInput, "id">;

export class ApiError extends Error {
  readonly status: number;
  readonly issues: ValidationIssue[];
  constructor(status: number, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

export function formatError(e: unknown): string {
  if (e instanceof ApiError && e.issues.length) return e.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("\n");
  return e instanceof Error ? e.message : String(e);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: ValidationIssue[] };
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? (data.errors ? "Please fix the highlighted fields" : res.statusText), data.errors ?? []);
  }
  return data as T;
}

export const api = {
  types: () => request<TypesInfo>("GET", "/api/types"),
  schemas: () => request<Schema[]>("GET", "/api/schemas"),
  createSchema: (s: NewSchema) => request<Schema>("POST", "/api/schemas", s),
  updateSchema: (id: string, s: NewSchema) => request<Schema>("PUT", `/api/schemas/${id}`, s),
  deleteSchema: (id: string) => request<void>("DELETE", `/api/schemas/${id}`),
  preview: (schema: unknown, count = 10) => request<{ rows: Row[]; warnings: number }>("POST", "/api/preview", { schema, count }),
  connections: () => request<Connection[]>("GET", "/api/connections"),
  saveConnection: (c: Partial<Connection>) =>
    c.id ? request<Connection>("PUT", `/api/connections/${c.id}`, c) : request<Connection>("POST", "/api/connections", c),
  deleteConnection: (id: string) => request<void>("DELETE", `/api/connections/${id}`),
  testConnection: (id: string) => request<{ ok: boolean; error?: string }>("POST", `/api/connections/${id}/test`),
  startSeed: (body: { connectionId: string; schemas: { id: string; count?: number }[]; mode: SeedMode; seed?: number }) =>
    request<{ jobId: string }>("POST", "/api/seed", body),
};

export interface GenerateParams {
  format: Format;
  dialect?: Dialect;
  count?: number;
  seed?: number;
  ddl?: boolean;
}

export function generateUrl(id: string, p: GenerateParams): string {
  const q = new URLSearchParams({ format: p.format });
  if (p.format === "sql" && p.dialect) q.set("dialect", p.dialect);
  if (p.count !== undefined) q.set("count", String(p.count));
  if (p.seed !== undefined) q.set("seed", String(p.seed));
  if (p.format === "sql" && p.ddl) q.set("ddl", "true");
  return `/api/schemas/${encodeURIComponent(id)}/generate?${q}`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadMulti(body: { schemaIds: string[]; counts?: Record<string, number> } & GenerateParams): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "mockgen";
  saveBlob(await res.blob(), name);
}
```

`apps/web/src/usePreview.ts`:
```ts
import { useEffect, useState } from "react";
import type { Row, ValidationIssue } from "@mockgen/core";
import { ApiError, api, formatError } from "./api.ts";

export interface PreviewState {
  rows: Row[];
  warnings: number;
  issues: ValidationIssue[];
  error: string | null;
  loading: boolean;
}

export function usePreview(draft: unknown, delay = 300): PreviewState {
  const [state, setState] = useState<PreviewState>({ rows: [], warnings: 0, issues: [], error: null, loading: false });
  const json = draft ? JSON.stringify(draft) : "";

  useEffect(() => {
    if (!json) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      api.preview(JSON.parse(json)).then(
        (r) => !cancelled && setState({ rows: r.rows, warnings: r.warnings, issues: [], error: null, loading: false }),
        (e: unknown) =>
          !cancelled &&
          setState((s) => ({
            ...s,
            issues: e instanceof ApiError ? e.issues : [],
            error: e instanceof ApiError && e.issues.length ? null : formatError(e),
            loading: false,
          })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [json, delay]);

  return state;
}
```

`apps/web/src/components/Dialog.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}
```

- [ ] **Step 7: Implement the app shell, entry and styles**

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/App.tsx` (shell; Tasks 2–3 replace the placeholders):
```tsx
import { useEffect, useState } from "react";
import { api, formatError, type TypesInfo } from "./api.ts";

type Route = { page: "list" } | { page: "edit"; id: string | null } | { page: "connections" };

function parseRoute(hash: string): Route {
  const m = /^#\/schemas\/([^/]+)$/.exec(hash);
  if (m) return { page: "edit", id: m[1] === "new" ? null : decodeURIComponent(m[1]!) };
  if (hash === "#/connections") return { page: "connections" };
  return { page: "list" };
}

export function navigate(hash: string): void {
  location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [types, setTypes] = useState<TypesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api.types().then(setTypes, (e: unknown) => setError(formatError(e)));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">mockgen</a>
        <nav>
          <a href="#/">Schemas</a>
          <a href="#/connections">Connections</a>
          <a href="/docs" target="_blank" rel="noreferrer">API docs</a>
        </nav>
      </header>
      <main>
        {error ? (
          <p className="error">Could not reach the server: {error}</p>
        ) : !types ? (
          <p className="muted">Loading…</p>
        ) : (
          <p className="muted">Page: {route.page}</p>
        )}
      </main>
    </div>
  );
}
```

`apps/web/src/styles.css`:
```css
:root {
  --bg: #f7f7f5;
  --surface: #ffffff;
  --text: #1d1d1b;
  --muted: #6b6b66;
  --border: #dcdcd6;
  --accent: #2f6fde;
  --accent-text: #ffffff;
  --error: #c62828;
  --warning: #9a6700;
  --code-bg: #f0f0ec;
  --radius: 6px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615;
    --surface: #1f1f1d;
    --text: #ececea;
    --muted: #a3a39d;
    --border: #3a3a36;
    --accent: #6b9cff;
    --accent-text: #0b0b0a;
    --error: #ff7b72;
    --warning: #e3b341;
    --code-bg: #2a2a27;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
a { color: var(--accent); }
code, pre { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; background: var(--code-bg); border-radius: 4px; }
code { padding: 0 4px; }
pre { padding: 10px; overflow-x: auto; white-space: pre-wrap; }

.topbar { display: flex; align-items: center; gap: 24px; padding: 10px 20px; background: var(--surface); border-bottom: 1px solid var(--border); }
.brand { font-weight: 700; font-size: 16px; text-decoration: none; color: var(--text); }
.topbar nav { display: flex; gap: 16px; }
main { padding: 20px; max-width: 1400px; margin: 0 auto; }

button, input, select, textarea { font: inherit; color: inherit; }
input, select, textarea { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 5px 8px; }
input[type="number"] { width: 90px; }
button { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); padding: 6px 12px; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.link { border: none; background: none; color: var(--accent); padding: 4px 0; }
button.icon { border: none; background: none; padding: 2px 6px; }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.muted { color: var(--muted); }
.error { color: var(--error); white-space: pre-wrap; }
.warning { color: var(--warning); }
small.error { display: block; font-size: 12px; }
.null { color: var(--muted); font-style: italic; }

.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.toolbar h1 { margin: 0 auto 0 0; font-size: 20px; }

table.list { width: 100%; border-collapse: collapse; background: var(--surface); }
table.list th, table.list td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--code-bg); }

.editor { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; }
@media (max-width: 1000px) { .editor { grid-template-columns: 1fr; } }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-bottom: 16px; }
.panel h3 { margin: 0 0 10px; font-size: 14px; }
.schema-settings { display: flex; flex-wrap: wrap; gap: 12px; }
.schema-settings label, .opt, .stack label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
.schema-settings input, .schema-settings select { color: var(--text); }

.field-row { display: grid; grid-template-columns: 18px 170px 200px minmax(0, 1fr) 110px 28px; gap: 8px; align-items: start; padding: 6px 0; border-bottom: 1px solid var(--border); }
.field-row .handle { cursor: grab; color: var(--muted); padding-top: 6px; user-select: none; }
.field-row input[aria-label="Field name"] { width: 100%; }
.field-row .blank { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.field-row .blank input { width: 64px; }
.nested { margin-left: 26px; border-left: 2px solid var(--border); padding-left: 8px; }
.options { display: flex; flex-wrap: wrap; gap: 8px; }
.opt.wide { flex: 1 1 100%; }
.opt.wide input { width: 100%; font-family: ui-monospace, Consolas, monospace; }
.list-editor { display: flex; flex-direction: column; gap: 4px; }
.list-editor div { display: flex; gap: 4px; }

.type-picker { position: relative; }
.type-picker > button { width: 100%; text-align: left; }
.popover { position: absolute; z-index: 10; top: 100%; left: 0; width: 320px; max-height: 360px; overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); padding: 8px; }
.popover input { width: 100%; margin-bottom: 6px; }
.popover h4 { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; color: var(--muted); }
.popover button { display: flex; justify-content: space-between; width: 100%; border: none; text-align: left; padding: 4px 6px; }
.popover button small { color: var(--muted); }
.popover button.active, .popover button:hover { background: var(--code-bg); }

.preview .table-wrap { overflow-x: auto; }
.preview table { border-collapse: collapse; font-size: 12px; }
.preview th, .preview td { border: 1px solid var(--border); padding: 4px 6px; white-space: nowrap; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }

.dialog { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); min-width: 420px; max-width: 90vw; padding: 16px; }
.dialog::backdrop { background: rgb(0 0 0 / 0.4); }
.dialog header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.dialog header h2 { margin: 0; font-size: 16px; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.stack label.check { flex-direction: row; align-items: center; gap: 6px; color: var(--text); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
progress { width: 100%; }

.connections { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; }
.connections ul { list-style: none; margin: 0; padding: 0; }
.connections li button { width: 100%; text-align: left; border: none; padding: 6px 8px; }
.connections li button.active { background: var(--code-bg); }
```

- [ ] **Step 8: Verify build, type check and dev server**

Run: `pnpm --filter @mockgen/web test && pnpm --filter @mockgen/web typecheck && pnpm --filter @mockgen/web build`
Expected: tests PASS, type check exit 0, `apps/web/dist/index.html` exists. Confirm the bundle does not contain faker: `grep -c "faker" apps/web/dist/assets/*.js` prints `0` for every file.

- [ ] **Step 9: Commit**

```bash
git add apps/web package.json .gitignore pnpm-lock.yaml
git commit -m "feat(web): scaffold React app with API client and field-tree helpers"
```

---

### Task 2: Schema list and schema editor with live preview

**Files:**
- Create: `apps/web/src/components/SchemaList.tsx`, `apps/web/src/components/SchemaEditor.tsx`, `apps/web/src/components/FieldList.tsx`, `apps/web/src/components/FieldRow.tsx`, `apps/web/src/components/TypePicker.tsx`, `apps/web/src/components/OptionsEditor.tsx`, `apps/web/src/components/Preview.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `SchemaList()`; `SchemaEditor({ id: string | null; types: TypesInfo })`
  - `interface EditorCtx { root: Field[]; setFields(fields: Field[]): void; types: TypesInfo; typeByKey: Map<string, FieldTypeInfo>; schemas: Schema[]; issues: ValidationIssue[] }` (exported from `FieldList.tsx`)
  - `FieldList({ parentPath: FieldPath; ctx: EditorCtx })`; `FieldRow({ field, path, ctx, onDragStart })`; `TypePicker({ value, types, onChange })`; `OptionsEditor({ type, options, onChange, errors, schemas })`; `Preview(props: PreviewState)`
  - SchemaEditor renders a right-hand column with a "Download…" button, a "Seed database…" button and the mock panel; those open components from Task 3. In this task render them as disabled buttons labelled exactly `Download…` and `Seed database…` and leave a `{/* MockPanel: Task 3 */}` slot.

This task is UI code with no unit tests of its own (the field-tree logic it relies on is tested in Task 1); it is verified by type check, build and the manual check in Step 9, and by the Playwright test in Task 4.

- [ ] **Step 1: Implement Preview**

`apps/web/src/components/Preview.tsx`:
```tsx
import type { PreviewState } from "../usePreview.ts";

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="null">null</span>;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function Preview({ rows, warnings, error, loading }: PreviewState) {
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  return (
    <section className="panel preview">
      <h3>
        Preview {loading && <span className="muted">updating…</span>}
      </h3>
      {error && <p className="error">{error}</p>}
      {warnings > 0 && <p className="warning">{warnings} formula error(s) produced empty values.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c} title={String(cell(r[c]))}>{cell(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Implement TypePicker**

`apps/web/src/components/TypePicker.tsx`:
```tsx
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
```

- [ ] **Step 3: Implement OptionsEditor**

`apps/web/src/components/OptionsEditor.tsx`:
```tsx
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
```

- [ ] **Step 4: Implement FieldRow and FieldList**

`apps/web/src/components/FieldList.tsx`:
```tsx
import { useState } from "react";
import type { Field, FieldTypeInfo, Schema, ValidationIssue } from "@mockgen/core";
import type { TypesInfo } from "../api.ts";
import { appendTo, getAt, moveWithin, newField, type FieldPath } from "../fieldTree.ts";
import { FieldRow } from "./FieldRow.tsx";

export interface EditorCtx {
  root: Field[];
  setFields(fields: Field[]): void;
  types: TypesInfo;
  typeByKey: Map<string, FieldTypeInfo>;
  schemas: Schema[];
  issues: ValidationIssue[];
}

export function FieldList({ parentPath, ctx }: { parentPath: FieldPath; ctx: EditorCtx }) {
  const list = parentPath.length ? (getAt(ctx.root, parentPath)?.children ?? []) : ctx.root;
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  return (
    <div className={parentPath.length ? "nested" : undefined}>
      {list.map((field, i) => {
        const path = [...parentPath, i];
        const kind = ctx.typeByKey.get(field.type)?.kind;
        return (
          <div
            key={i}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.stopPropagation();
              if (dragFrom !== null && dragFrom !== i) ctx.setFields(moveWithin(ctx.root, parentPath, dragFrom, i));
              setDragFrom(null);
            }}
          >
            <FieldRow field={field} path={path} ctx={ctx} onDragStart={() => setDragFrom(i)} />
            {(kind === "object" || kind === "array") && <FieldList parentPath={path} ctx={ctx} />}
          </div>
        );
      })}
      <button type="button" className="link" onClick={() => ctx.setFields(appendTo(ctx.root, parentPath, newField(list)))}>
        + Add {parentPath.length ? "nested field" : "field"}
      </button>
    </div>
  );
}
```

`apps/web/src/components/FieldRow.tsx`:
```tsx
import type { Field } from "@mockgen/core";
import { issuesAt, newField, removeAt, updateAt, type FieldPath } from "../fieldTree.ts";
import type { EditorCtx } from "./FieldList.tsx";
import { OptionsEditor } from "./OptionsEditor.tsx";
import { TypePicker } from "./TypePicker.tsx";

export function FieldRow({ field, path, ctx, onDragStart }: {
  field: Field;
  path: FieldPath;
  ctx: EditorCtx;
  onDragStart: () => void;
}) {
  const errors = issuesAt(ctx.issues, path);
  const type = ctx.typeByKey.get(field.type);
  const set = (patch: Partial<Field>) => ctx.setFields(updateAt(ctx.root, path, patch));

  const changeType = (key: string) => {
    const kind = ctx.typeByKey.get(key)?.kind;
    const nests = kind === "object" || kind === "array";
    set({ type: key, options: {}, children: nests ? (field.children?.length ? field.children : [newField([])]) : undefined });
  };

  return (
    <div className="field-row" data-testid="field-row">
      <span
        className="handle"
        draggable
        title="Drag to reorder"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", field.name);
          onDragStart();
        }}
      >
        ⠿
      </span>
      <label>
        <input aria-label="Field name" value={field.name} onChange={(e) => set({ name: e.target.value })} />
        {errors.name && <small className="error">{errors.name}</small>}
      </label>
      <div>
        <TypePicker value={field.type} types={ctx.types.types} onChange={changeType} />
        {errors.type && <small className="error">{errors.type}</small>}
      </div>
      <div>
        {type && (
          <OptionsEditor type={type} options={field.options} onChange={(options) => set({ options })} errors={errors} schemas={ctx.schemas} />
        )}
        {errors.children && <small className="error">{errors.children}</small>}
      </div>
      <label className="blank">
        <input
          aria-label="Blank %"
          type="number"
          min={0}
          max={100}
          value={field.blankPercent}
          onChange={(e) => set({ blankPercent: Number(e.target.value) })}
        />
        % blank
        {errors.blankPercent && <small className="error">{errors.blankPercent}</small>}
      </label>
      <button type="button" className="icon" aria-label="Remove field" onClick={() => ctx.setFields(removeAt(ctx.root, path))}>
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Implement SchemaEditor**

`apps/web/src/components/SchemaEditor.tsx`:
```tsx
import { useEffect, useMemo, useState } from "react";
import type { Field, Schema, ValidationIssue } from "@mockgen/core";
import { ApiError, api, formatError, type NewSchema, type TypesInfo } from "../api.ts";
import { navigate } from "../App.tsx";
import { slugify } from "../fieldTree.ts";
import { usePreview } from "../usePreview.ts";
import { FieldList, type EditorCtx } from "./FieldList.tsx";
import { Preview } from "./Preview.tsx";

type Draft = NewSchema & { id?: string; fields: Field[] };

const emptyDraft = (): Draft => ({
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
      const s = draftId ? await api.updateSchema(draftId, body) : await api.createSchema(body);
      setSaved(s);
      setDraft(s);
      setSaveIssues([]);
      setMessage("Saved");
      if (!draftId) navigate(`#/schemas/${s.id}`);
    } catch (e) {
      if (e instanceof ApiError) setSaveIssues(e.issues);
      setMessage(formatError(e));
    }
  };

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
            <button type="button" disabled>Download…</button>
            <button type="button" disabled>Seed database…</button>
          </section>
          {/* MockPanel: Task 3 */}
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement SchemaList**

`apps/web/src/components/SchemaList.tsx`:
```tsx
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
      const { id: _id, ...rest } = JSON.parse(await file.text()) as NewSchema & { id?: string };
      return api.createSchema(rest);
    });

  return (
    <div>
      <div className="toolbar">
        <h1>Schemas</h1>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <button type="button" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <a className="button primary" href="#/schemas/new" role="link">New schema</a>
      </div>
      {error && <p className="error">{error}</p>}
      {schemas && schemas.length === 0 && <p className="muted">No schemas yet. Create one to start generating data.</p>}
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
```

Add to `apps/web/src/styles.css`:
```css
a.button { display: inline-block; border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 12px; text-decoration: none; }
a.button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
```

- [ ] **Step 7: Route to the new pages**

In `apps/web/src/App.tsx` add imports and replace the placeholder `<p className="muted">Page: {route.page}</p>`:
```tsx
import { SchemaEditor } from "./components/SchemaEditor.tsx";
import { SchemaList } from "./components/SchemaList.tsx";
// ...
        ) : route.page === "edit" ? (
          <SchemaEditor key={route.id ?? "new"} id={route.id} types={types} />
        ) : route.page === "connections" ? (
          <p className="muted">Connections</p>
        ) : (
          <SchemaList />
        )}
```

- [ ] **Step 8: Type check and build**

Run: `pnpm --filter @mockgen/web typecheck && pnpm --filter @mockgen/web build`
Expected: exit 0 for both.

- [ ] **Step 9: Manual check in the browser**

Start the API: (Git Bash) `DATA_DIR=./data pnpm --filter @mockgen/server dev` (background), then `pnpm --filter @mockgen/web dev` (background). Open `http://localhost:5173`.
Expected:
- "New schema" opens the editor with 4 default fields; the preview shows 10 rows with `@example.com` emails.
- Typing a Name fills Slug automatically.
- Changing a field's type to `Number` and setting min 9, max 1 shows "min must be less than or equal to max" under `min`.
- Changing a type to `Object` adds a nested field; adding a formula `upper(field_1.first_name)`-style path works.
- Dragging a row by its handle reorders it.
- Save navigates to `#/schemas/<uuid>`; the list shows the schema; Duplicate, Export JSON, Import JSON and Delete work.
Stop both servers afterwards.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): schema list and editor with live preview"
```

---

### Task 3: Download, mock, seed and connections UI

**Files:**
- Create: `apps/web/src/components/DownloadDialog.tsx`, `apps/web/src/components/MockPanel.tsx`, `apps/web/src/components/SeedDialog.tsx`, `apps/web/src/components/Connections.tsx`
- Modify: `apps/web/src/components/SchemaEditor.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 1–2; server endpoints from Parts 2–3.
- Produces: `DownloadDialog({ schema, all, types, onClose })`; `MockPanel({ schema, onToggle })`; `SeedDialog({ schema, all, onClose })`; `Connections()`.

- [ ] **Step 1: Implement DownloadDialog**

`apps/web/src/components/DownloadDialog.tsx`:
```tsx
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
    if (!withRefs) {
      location.href = generateUrl(schema.id, { format, dialect, count, seed, ddl });
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
```

- [ ] **Step 2: Implement MockPanel**

`apps/web/src/components/MockPanel.tsx`:
```tsx
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
          {!hasId && <p className="muted">Add a top-level <code>id</code> field of type Row number to enable <code>/{"{id}"}</code> requests.</p>}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Implement SeedDialog**

`apps/web/src/components/SeedDialog.tsx`:
```tsx
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
```

- [ ] **Step 4: Implement Connections**

`apps/web/src/components/Connections.tsx`:
```tsx
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
```

- [ ] **Step 5: Wire everything into the editor and router**

In `apps/web/src/components/SchemaEditor.tsx`:

Add imports:
```tsx
import { DownloadDialog } from "./DownloadDialog.tsx";
import { MockPanel } from "./MockPanel.tsx";
import { SeedDialog } from "./SeedDialog.tsx";
```

Add state after `const [slugTouched, ...]`:
```tsx
  const [dialog, setDialog] = useState<null | "download" | "seed">(null);
```

Add after the `save` function:
```tsx
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
```

Replace the `<aside>…</aside>` block with:
```tsx
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
```

In `apps/web/src/App.tsx` add `import { Connections } from "./components/Connections.tsx";` and replace `<p className="muted">Connections</p>` with `<Connections />`.

- [ ] **Step 6: Type check and build**

Run: `pnpm --filter @mockgen/web typecheck && pnpm --filter @mockgen/web build`
Expected: exit 0.

- [ ] **Step 7: Manual check in the browser**

Start both servers as in Task 2 Step 9.
Expected:
- Download… on a saved schema downloads `<slug>.csv`; SQL shows dialect and CREATE TABLE options; a schema with a reference offers "Include referenced schemas" and downloads `mockgen.zip` / `mockgen.sql`.
- Mock toggle enables `/mock/<slug>`; `curl http://localhost:8080/mock/<slug>/1` returns a row.
- Connections: create a SQLite connection `seed.db`, Test shows "Connection works"; Seed database… with it shows progress bars and "Done."; the file `data/seed.db` contains the table.
Stop both servers.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): download, mock, seed and connections UI"
```

---

### Task 4: Playwright smoke test, Docker image, compose and README

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`

**Interfaces:**
- Consumes: the full app from Parts 1–4.
- Produces: `pnpm --filter @mockgen/web e2e`; image `mockgen:latest`; `docker compose up` on `http://localhost:8080`.

- [ ] **Step 1: Write the Playwright config and smoke test**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

const port = 8091;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "node --disable-warning=ExperimentalWarning ../server/src/main.ts",
    url: `http://localhost:${port}/health`,
    reuseExistingServer: false,
    env: { PORT: String(port), DATA_DIR: "./.e2e-data", WEB_DIR: "./dist" },
  },
});
```

`apps/web/e2e/smoke.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("create a schema, preview it, download CSV and serve it as a mock", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "New schema" }).click();

  await page.getByLabel("Name", { exact: true }).fill("People");
  await expect(page.getByLabel("Slug")).toHaveValue("people");

  const rows = page.locator("section.preview tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(page.locator("section.preview")).toContainText("@example.com");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/schemas\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Download…" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("people.csv");

  await page.getByLabel(/Serve this schema/).check();
  await expect.poll(async () => (await request.get("/mock/people/1")).status()).toBe(200);
  const body = await (await request.get("/mock/people?pageSize=5")).json();
  expect(body.total).toBe(100);
  expect(body.data).toHaveLength(5);
});
```

- [ ] **Step 2: Run the smoke test**

Run: `pnpm --filter @mockgen/web exec playwright install chromium`
Expected: Chromium downloads (first time only).

Run: `pnpm --filter @mockgen/web e2e`
Expected: 1 passed. If a locator fails because a label differs, fix the component label (the labels in this plan are the contract), not the test.

- [ ] **Step 3: Write the Docker files**

`.dockerignore`:
```
**/node_modules
.git
data
**/dist
**/.e2e-data
**/test-results
**/playwright-report
docs
```

`Dockerfile`:
```dockerfile
FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @mockgen/web build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/apps/web/dist
RUN pnpm install --frozen-lockfile --prod --filter "@mockgen/server..."
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"]
```

`docker-compose.yml`:
```yaml
services:
  mockgen:
    build: .
    image: mockgen:latest
    ports:
      - "8080:8080"
    volumes:
      - mockgen-data:/data
    environment:
      # Referenced from connection profiles as ${PG_PASSWORD} / ${MSSQL_PASSWORD}.
      PG_PASSWORD: mockgen
      MSSQL_PASSWORD: "Mockgen!Passw0rd"

  postgres:
    profiles: ["dbs"]
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: mockgen
      POSTGRES_PASSWORD: mockgen
      POSTGRES_DB: mockgen
    ports:
      - "5432:5432"

  mssql:
    profiles: ["dbs"]
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "Mockgen!Passw0rd"
    ports:
      - "1433:1433"

volumes:
  mockgen-data:
```

- [ ] **Step 4: Build and run the container**

Run: `docker compose build`
Expected: build succeeds.

Run: `docker compose up -d mockgen`, then `curl -s http://localhost:8080/health` and `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/`
Expected: `{"status":"ok"}` and `200`.

Run: `docker compose ps`
Expected: `mockgen` is `healthy` after ~30 s.

Run: `docker compose down`

If `pnpm install --prod --filter "@mockgen/server..."` fails on the frozen lockfile, replace that line with `RUN pnpm install --frozen-lockfile --prod` (installs production deps for all workspace packages; the web package has only React, so the image grows only slightly) and rebuild.

- [ ] **Step 5: Write the README**

`README.md`:
````markdown
# mockgen

A self-hosted, Mockaroo-style mock data generator that runs in one Docker container.

- Build schemas in the browser and preview them live
- Download CSV, JSON, NDJSON or SQL (PostgreSQL, SQL Server, SQLite)
- Generate data from scripts through a REST API (`/docs`)
- Serve schemas as stable, read-only mock REST endpoints (`/mock/<slug>`)
- Seed PostgreSQL, SQL Server or SQLite databases directly

## Run it

```bash
docker compose up -d
```

Open http://localhost:8080. Data (schemas and connection profiles) is stored in the `mockgen-data` volume.

To try seeding against local databases too:

```bash
docker compose --profile dbs up -d
```

Then add connections in the UI: host `postgres`, user `mockgen`, database `mockgen`, password `${PG_PASSWORD}`; or host `mssql`, user `sa`, database `master`, password `${MSSQL_PASSWORD}`, Encrypt off.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Where `mockgen.db` (and SQLite seed targets) live |
| `MAX_ROWS` | `1000000` | Maximum rows per generate or seed request |
| `MOCK_SCAN_LIMIT` | `10000` | Maximum rows scanned by mock equality filters |

## Field types

About 120 types: faker-backed types (names, emails, addresses, finance, commerce, vehicles, dates and more) in the schema's locale, plus:

- **Row number**, **UUID**, **Number** (range, decimals), **Boolean** (true %), **Custom list** (weighted values), **Regular expression**
- **Formula**: computed from sibling fields
- **Reference**: picks a value from another schema's rows (foreign keys)
- **Object** and **Array**: nested JSON (flattened to `parent_child` columns in CSV/SQL; arrays become JSON text)

Every field has a **blank %**. Output is deterministic for a given seed. Relative dates (past, future, birthdate) are computed from a fixed reference date, 2026-01-01.

## Formulas

Expressions can use sibling field names (and `object.child` for nested values), literals, `+ - * / %`, comparisons, `&&`, `||`, `!` and these functions:

| Function | Example |
|---|---|
| `concat(a, b, …)` | `concat(first_name, " ", last_name)` |
| `lower(s)`, `upper(s)`, `trim(s)`, `slug(s)` | `lower(first_name) + "@example.com"` |
| `if(cond, a, b)` | `if(age >= 18, "adult", "minor")` |
| `round(n, digits)` | `round(qty * price, 2)` |
| `dateAdd(date, amount, unit)` | `dateAdd(order_date, 3, "days")` (units: years, months, days, hours, minutes) |
| `coalesce(a, b, …)` | `coalesce(nickname, first_name)` |

`+` concatenates when either side is text. Arithmetic with a blank value gives blank. A formula error (such as division by zero) produces a blank value and is counted as a warning in the preview.

## API

Interactive docs: http://localhost:8080/docs. The main endpoints:

```bash
# One schema as a file
curl -o customers.csv "http://localhost:8080/api/schemas/<id>/generate?format=csv&count=1000"

# Several related schemas: one SQL script (parents first) or a zip
curl -o data.sql -X POST http://localhost:8080/api/generate \
  -H "content-type: application/json" \
  -d '{"schemaIds":["<orders-id>"],"format":"sql","dialect":"mssql","ddl":true}'

# Mock endpoints (enable "Serve this schema" first)
curl "http://localhost:8080/mock/customers?page=1&pageSize=20"
curl "http://localhost:8080/mock/customers/1"
curl "http://localhost:8080/mock/customers?country=DK"
```

## Development

Requirements: Node 24+, pnpm 11, Docker (for integration tests).

```bash
pnpm install
pnpm test                                   # unit tests, all packages
pnpm typecheck
pnpm --filter @mockgen/server test:it       # Postgres + SQL Server via Testcontainers
pnpm --filter @mockgen/web e2e              # Playwright smoke test
```

Run locally with hot reload (two terminals):

```bash
DATA_DIR=./data pnpm --filter @mockgen/server dev
pnpm --filter @mockgen/web dev               # http://localhost:5173, proxies the API
```

Layout: `packages/core` (schema model, generator, formats; no I/O), `apps/server` (Fastify API, mock endpoints, seeding), `apps/web` (React UI).
````

- [ ] **Step 6: Run the full suite one last time**

Run: `pnpm test && pnpm typecheck`
Expected: all packages PASS; type checks exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web Dockerfile .dockerignore docker-compose.yml README.md
git commit -m "feat: Playwright smoke test, Docker image, compose file and README"
```
