import fs from "node:fs";
import path from "node:path";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  maxRows: number;
  mockScanLimit: number;
  webDir: string | null;
  allowedHosts: string[];
  /**
   * Whether this instance may open connections to databases. Off turns the connection and seed
   * routes into 404s and hides their part of the UI.
   *
   * It exists because mockgen has no authentication, and those are the only routes that reach
   * outside the container: a caller names any host and port, the server dials it, and seeding
   * writes into whatever answers. On a private instance that is the feature. On one exposed to
   * the internet it is a way into the network the container sits on — a stranger could probe for
   * open ports and truncate a table — so a public deployment runs with this off and keeps the
   * generator, which touches nothing but itself.
   */
  dbTargets: boolean;
}

const TRUTHY = ["1", "true", "yes", "on"];
const FALSY = ["0", "false", "no", "off"];

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (TRUTHY.includes(v)) return true;
  if (FALSY.includes(v)) return false;
  // Deliberately loud rather than falling back. A typo in the variable that locks a public
  // instance down would otherwise leave it running wide open, with nothing saying so.
  throw new Error(`${name} must be one of ${[...TRUTHY, ...FALSY].join(", ")}, got "${raw}"`);
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const defaultWeb = path.resolve(import.meta.dirname, "../../web/dist");
  const webDir = path.resolve(env.WEB_DIR || defaultWeb);
  return {
    port: positiveInt(env, "PORT", 8080),
    host: "0.0.0.0",
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : "/data",
    maxRows: positiveInt(env, "MAX_ROWS", 1_000_000),
    mockScanLimit: positiveInt(env, "MOCK_SCAN_LIMIT", 10_000),
    allowedHosts: (env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    // Defaults on, so `docker compose up` on a laptop still seeds databases. The deployment that
    // needs it off is the unusual one, and it says so explicitly.
    dbTargets: flag(env, "DB_TARGETS", true),
    webDir: fs.existsSync(path.join(webDir, "index.html")) ? webDir : null,
  };
}
