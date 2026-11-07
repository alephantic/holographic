// Vercel entry point: every /api/* request is rewritten here (see vercel.json)
// and handled by the same Hono app the local server uses. Credentials come
// from Vercel's environment variables, never from the client.
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

export default handle(app);
