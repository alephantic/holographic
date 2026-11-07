import { Hono } from "hono";
import { chatApp } from "./chat.js";
import { entriesApp } from "./entries.js";
import { memoriesApp } from "./memories.js";

// The HTTP app, independent of how it is hosted: server/index.ts runs it as a
// long-lived Node process locally; api/index.ts exposes it as a Vercel function.
export const app = new Hono();

app.route("/api", chatApp);
app.route("/api", entriesApp);
app.route("/api", memoriesApp);
