import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { app } from "./app.js";
import { selectProvider } from "./providers.js";

// Load .env if present (Node 20.12+/22 built-in; no dotenv dependency).
// Variables already set in the environment take precedence.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    console.warn("Could not read .env:", error);
  }
}

const port = Number(process.env.PORT ?? 8787);

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
    }`,
  );
});
