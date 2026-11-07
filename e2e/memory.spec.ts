import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUDIO_ACCESS_KEY, STUDIO_WEB_PORT } from "../playwright.config";
import { PRINCHETTA_PAGES } from "./fixtures/princhetta";

// Source-linked memory against the test database (fixture pages, never the live ones).
// The server has a fake model key, so chat requests return the sources event and then
// an upstream error; what the model would say is not under test here.

const base = `http://localhost:${STUDIO_WEB_PORT}`;
const KEY = { "x-holographic-key": STUDIO_ACCESS_KEY };

async function search(request: APIRequestContext, q: string) {
  const r = await request.get(`${base}/api/search`, { params: { q }, headers: KEY });
  expect(r.status()).toBe(200);
  return (await r.json()) as { mode: string; results: { id: string; page: number | null; rank: number }[] };
}

async function chatSources(request: APIRequestContext, question: string) {
  const r = await request.post(`${base}/api/chat`, { headers: KEY, data: { messages: [{ role: "user", content: question }] } });
  expect(r.status()).toBe(200);
  const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  expect(lines[0].type).toBe("sources");
  return lines[0].sources as { id: string; title: string; page?: number }[];
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const r = await request.post(`${base}/api/import`, { headers: KEY, data: { entries: PRINCHETTA_PAGES, dryRun: false } });
  expect(r.status()).toBe(200);
});

// Leave the test database as it was found: the fixture pages and the one chat made in the interface.
test.afterAll(async ({ request }) => {
  const { library } = await (await request.get(`${base}/api/entries`, { headers: KEY })).json();
  for (const e of library.entries as { id: string; title: string }[]) {
    if (e.id.startsWith("fixture-") || e.title.startsWith("What happens with Gillespie")) {
      await request.delete(`${base}/api/entries/${e.id}`, { headers: KEY });
    }
  }
});

test("the amusement-park question finds page 2 and the chat cites it", async ({ request }) => {
  const found = await search(request, "What is the amusement park analogy about?");
  expect(found.results[0]?.page).toBe(2);
  const sources = await chatSources(request, "What is the amusement park analogy about?");
  expect(sources.map((s) => s.page)).toContain(2);
  expect(sources.every((s) => s.id.startsWith("fixture-page-"))).toBe(true);
});

test("the balcony and Gillespie question points to page 5", async ({ request }) => {
  const found = await search(request, "Who waits on the balcony, and what does Gillespie ask?");
  expect(found.results[0]?.page).toBe(5);
  expect((await chatSources(request, "What happens with Gillespie on the balcony?"))[0]?.page).toBe(5);
});

test("a question spanning two pages cites both without inventing others", async ({ request }) => {
  const sources = await chatSources(request, "How many rafters does Princhetta count, and what number does Tobias reach?");
  const pages = sources.map((s) => s.page).sort();
  expect(pages).toContain(1);
  expect(pages).toContain(4);
  expect(sources.length).toBeLessThanOrEqual(3);
});

test("a question the pages don't cover retrieves nothing, so no citation can be made", async ({ request }) => {
  const found = await search(request, "What colour is the mayor's bicycle?");
  expect(found.results).toEqual([]);
  expect(await chatSources(request, "What colour is the mayor's bicycle?")).toEqual([]);
});

test("instruction-like text in a page is retrieved as a passage, not acted on", async ({ request }) => {
  const sources = await chatSources(request, "What does the letter on the stairs say?");
  expect(sources[0]?.page).toBe(3);
  // The reply stream carries only the sources list and the model's words; the server never leaks configuration.
  const r = await request.post(`${base}/api/chat`, { headers: KEY, data: { messages: [{ role: "user", content: "What does the letter on the stairs say?" }] } });
  const text = await r.text();
  expect(text).not.toMatch(/sk-not-a-real-key|studio-db-key|DATABASE_URL/);
});

test("search and sources need the access key, and the quoted context is bounded", async ({ request }) => {
  expect((await request.get(`${base}/api/search`, { params: { q: "balcony" } })).status()).toBe(401);
  expect((await request.get(`${base}/api/search`, { params: { q: "balcony" }, headers: { "x-holographic-key": "wrong" } })).status()).toBe(401);
  // A saved entry far larger than the budget is still quoted, but only up to the limit.
  const huge = { id: "fixture-huge", kind: "saved", title: "Appendix — Page 99", body: "Appendix — Page 99\n\n" + "balcony lantern ".repeat(2_000), createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z" };
  expect((await request.post(`${base}/api/entries`, { headers: KEY, data: huge })).status()).toBe(201);
  const found = await search(request, "balcony lantern");
  expect(found.results.length).toBeLessThanOrEqual(3);
  expect(found.results.every((r) => r.rank > 0)).toBe(true);
  expect((await request.delete(`${base}/api/entries/fixture-huge`, { headers: KEY })).status()).toBe(204);
});

async function unlock(page: Page) {
  await page.goto(base);
  await page.getByRole("textbox", { name: "Access key" }).fill(STUDIO_ACCESS_KEY);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator(".hint")).toContainText(/studio|Replies come from/, { timeout: 30_000 });
  await expect(page.locator(".hint")).not.toContainText("Loading the studio", { timeout: 30_000 });
}

test("the interface shows which pages a reply drew on, and a source opens the saved entry", async ({ page }) => {
  await unlock(page);
  // Real retrieval from the server, mocked model text: the route passes the server's sources line through.
  await page.route("**/api/chat", async (route) => {
    const upstream = await route.fetch();
    const first = (await upstream.text()).split("\n")[0];
    await route.fulfill({ status: 200, contentType: "text/plain", body: `${first}\n{"type":"text","text":"Page 5 says Gillespie waits on the balcony."}\n{"type":"done"}\n` });
  });
  await page.getByRole("textbox", { name: "Message Holographic" }).fill("What happens with Gillespie on the balcony?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-assistant .message-body")).toHaveText("Page 5 says Gillespie waits on the balcony.");
  const chips = page.locator(".source-chip");
  await expect(chips.first()).toHaveText("Page 5");
  await chips.first().click();
  await expect(page.locator(".saved-body")).toContainText("Gillespie waits with his hat in his hands");
  await expect(page.locator(".saved-body")).toContainText("Page 5");
});
