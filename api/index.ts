// Vercel entry point: every /api/* request is rewritten here (see vercel.json)
// and handled by the same Hono app the local server uses. Vercel invokes this
// Node-style as (request, response); getRequestListener bridges that to the
// app's fetch handler, streaming included. Credentials come from Vercel's
// environment variables, never from the client.
import { getRequestListener } from "@hono/node-server";
import { app } from "../server/app.js";

export default getRequestListener(app.fetch);
