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
    webDir: fs.existsSync(path.join(webDir, "index.html")) ? webDir : null,
  };
}
