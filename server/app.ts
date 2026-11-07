import { Hono } from "hono";
import { chatApp } from "./chat.js";

// The HTTP app, independent of how it is hosted: server/index.ts runs it as a
// long-lived Node process locally; api/index.ts exposes it as a Vercel function.
export const app = new Hono();

app.route("/api", chatApp);
