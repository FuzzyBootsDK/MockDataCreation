import { z } from "zod";
import { HttpError } from "../errors.ts";

const base = { id: z.string().min(1), name: z.string().min(1).max(200) };
const server = {
  host: z.string().min(1, "Enter a host"),
  database: z.string().min(1, "Enter a database"),
  user: z.string().min(1, "Enter a user"),
  password: z.string().default(""),
};

export const ConnectionSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, ...server, kind: z.literal("pg"), port: z.number().int().min(1).max(65535).default(5432), ssl: z.boolean().default(false) }),
  z.object({
    ...base,
    ...server,
    kind: z.literal("mssql"),
    port: z.number().int().min(1).max(65535).default(1433),
    encrypt: z.boolean().default(true),
    trustServerCertificate: z.boolean().default(true),
  }),
  z.object({ ...base, kind: z.literal("sqlite"), file: z.string().min(1, "Enter a file path") }),
]);

export type Connection = z.infer<typeof ConnectionSchema>;

const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function resolveSecret(value: string, env: NodeJS.ProcessEnv): string {
  const m = ENV_REF.exec(value);
  if (!m) return value;
  if (!m[1]!.startsWith("MOCKGEN_SECRET_")) {
    throw new HttpError(400, "Only environment variables starting with MOCKGEN_SECRET_ can be referenced");
  }
  const v = env[m[1]!];
  if (v === undefined) throw new HttpError(400, `Environment variable ${m[1]} is not set`);
  return v;
}
