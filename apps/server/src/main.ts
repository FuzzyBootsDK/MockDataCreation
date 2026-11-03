import path from "node:path";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";

const config = loadConfig();
const db = openDb(path.join(config.dataDir, "mockgen.db"));
const app = await buildApp({ config, db });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
if (!config.webDir) app.log.warn("Web UI not found; build apps/web or set WEB_DIR. API is available.");
