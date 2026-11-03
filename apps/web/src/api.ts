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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
