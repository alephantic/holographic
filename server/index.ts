import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "./app.js";
import { getPool, loadDotEnv, RemoteDatabaseRefused, storageConfigured } from "./db/client.js";
import { selectProvider } from "./providers.js";

// Load .env if present; variables already set in the environment take precedence.
loadDotEnv();

const port = Number(process.env.PORT ?? 8787);

// Fail fast if this process would talk to a remote database without having been told to.
if (storageConfigured()) {
  try {
    getPool();
  } catch (error) {
    if (error instanceof RemoteDatabaseRefused) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

// In production the same process serves the built client from dist/.
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: app.fetch, port }, (info) => {
  const provider = selectProvider();
  console.log(
    `Holographic API on http://localhost:${info.port} — ${
      provider ? `${provider.name} · ${provider.model}` : "no model configured (Save still works)"
    } · storage ${storageConfigured() ? "database" : "browser only"}`,
  );
});
