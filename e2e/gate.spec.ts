import { expect, test } from "@playwright/test";
import { LOCKED_ACCESS_KEY, LOCKED_WEB_PORT } from "../playwright.config";

// Every route that can read, create, change, delete, import, or export content,
// plus chat and the key check itself, must refuse a missing or wrong key.
// The locked server has an access key and a fake model key but no database,
// so a correct key reaches the next check (503 storage not configured) rather than content.

const base = `http://localhost:${LOCKED_WEB_PORT}`;
const entry = { id: "gate-1", kind: "saved", title: "t", body: "b", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const message = { id: "gate-m", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" };

export const PROTECTED_ROUTES: { method: "get" | "post" | "patch" | "delete"; path: string; data?: unknown; withKey: number }[] = [
  { method: "get", path: "/api/entries", withKey: 503 },
  { method: "get", path: "/api/entries/gate-1", withKey: 503 },
  { method: "post", path: "/api/entries", data: entry, withKey: 503 },
  { method: "post", path: "/api/entries/gate-1/messages", data: message, withKey: 503 },
  { method: "patch", path: "/api/entries/gate-1/messages/gate-m", data: { note: "n" }, withKey: 503 },
  { method: "delete", path: "/api/entries/gate-1", withKey: 503 },
  { method: "post", path: "/api/import", data: { entries: [entry], dryRun: true }, withKey: 503 },
  { method: "get", path: "/api/export", withKey: 503 },
  { method: "post", path: "/api/chat", data: { messages: [{ role: "user", content: "hi" }] }, withKey: 200 },
  { method: "post", path: "/api/access", withKey: 204 },
];

for (const route of PROTECTED_ROUTES) {
  test(`${route.method.toUpperCase()} ${route.path}: no key 401, wrong key 401, right key passes the gate`, async ({ request }) => {
    const opts = (headers?: Record<string, string>) => ({ data: route.data, headers });
    expect((await request[route.method](`${base}${route.path}`, opts())).status()).toBe(401);
    expect((await request[route.method](`${base}${route.path}`, opts({ "x-holographic-key": "wrong" }))).status()).toBe(401);
    expect((await request[route.method](`${base}${route.path}`, opts({ "x-holographic-key": LOCKED_ACCESS_KEY.toUpperCase() }))).status()).toBe(401);
    expect((await request[route.method](`${base}${route.path}`, opts({ "x-holographic-key": LOCKED_ACCESS_KEY }))).status()).toBe(route.withKey);
  });
}

test("the only open route is status, and it carries no content", async ({ request }) => {
  const res = await request.get(`${base}/api/status`);
  expect(res.status()).toBe(200);
  expect(Object.keys(await res.json()).sort()).toEqual(["accessRequired", "configured", "model", "provider", "storage"]);
  // Unknown paths under /api meet the key check before routing, so they reveal nothing either.
  expect((await request.get(`${base}/api/nothing`)).status()).toBe(401);
});
