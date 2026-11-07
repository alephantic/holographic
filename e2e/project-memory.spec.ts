import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUDIO_ACCESS_KEY, STUDIO_WEB_PORT } from "../playwright.config";

// Project memory against the test database, with the deterministic test provider:
// a fixture conversation holds one explicit decision, one tentative idea, one AI
// suggestion, and a pasted story line. Nothing here touches live data.

const base = `http://localhost:${STUDIO_WEB_PORT}`;
const KEY = { "x-holographic-key": STUDIO_ACCESS_KEY };
const at = (m: number) => `2026-11-07T10:${String(m).padStart(2, "0")}:00.000Z`;

const FIXTURE_CHAT = {
  id: "fixture-planning-chat",
  kind: "chat",
  title: "Planning the studio",
  createdAt: at(0),
  updatedAt: at(4),
  messages: [
    { id: "fx-m1", role: "user", content: "Decision: the studio keeps one shared access key for now.", createdAt: at(0) },
    { id: "fx-m2", role: "assistant", content: "You could add a timeline view of saved entries later.", createdAt: at(1) },
    { id: "fx-m3", role: "user", content: "Maybe a timeline is worth it, but I'm not sure yet.", createdAt: at(2) },
    { id: "fx-m4", role: "user", content: "Here is a page I pasted: “Princhetta decided to leave the balcony forever.” What do you make of it?", createdAt: at(3) },
    { id: "fx-m5", role: "assistant", content: "It reads as a turning point for her.", createdAt: at(4) },
    { id: "fx-m6", role: "user", content: "From the manuscript, page 6:\nPrinchetta decided to burn the preface and start again.\nIs that too abrupt?", createdAt: at(5) },
  ],
};

async function unlock(page: Page) {
  await page.goto(base);
  await page.getByRole("textbox", { name: "Access key" }).fill(STUDIO_ACCESS_KEY);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator(".hint")).toContainText(/studio|Replies come from/, { timeout: 30_000 });
  await expect(page.locator(".hint")).not.toContainText("Loading the studio", { timeout: 30_000 });
}

async function memories(request: APIRequestContext) {
  const r = await request.get(`${base}/api/project`, { headers: KEY });
  expect(r.status()).toBe(200);
  return (await r.json()).memories as { id: string; kind: string; status: string; text: string; attributedTo: string; source: { messageId: string | null; quote: string | null } }[];
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const r = await request.post(`${base}/api/import`, { headers: KEY, data: { entries: [FIXTURE_CHAT], dryRun: false } });
  expect(r.status()).toBe(200);
});

test("the new routes refuse missing and wrong keys", async ({ request }) => {
  for (const [method, path] of [
    ["get", "/api/project"],
    ["post", "/api/project/capture"],
    ["post", "/api/memories/x/accept"],
    ["post", "/api/memories/x/correct"],
    ["get", "/api/memories/x/history"],
  ] as const) {
    expect((await request[method](`${base}${path}`)).status(), `${method} ${path} no key`).toBe(401);
    expect((await request[method](`${base}${path}`, { headers: { "x-holographic-key": "wrong" } })).status(), `${method} ${path} wrong key`).toBe(401);
  }
});

test("capturing a chat proposes labelled candidates with the right attribution", async ({ page, request }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Chat: Planning the studio" }).click();
  await page.getByRole("button", { name: "Remember this chat" }).click();
  await expect(page.getByRole("button", { name: "Proposed, see Project memory" })).toBeVisible({ timeout: 20_000 });

  const all = await memories(request);
  expect(all.every((m) => m.status === "suggested")).toBe(true);
  const byMsg = Object.fromEntries(all.map((m) => [m.source.messageId, m]));
  expect(byMsg["fx-m1"]).toMatchObject({ kind: "decision", attributedTo: "person", source: { quote: "Decision: the studio keeps one shared access key for now." } });
  expect(byMsg["fx-m2"]).toMatchObject({ kind: "open", attributedTo: "assistant" }); // the AI's suggestion never becomes a decision
  expect(byMsg["fx-m3"]).toMatchObject({ kind: "open", attributedTo: "person" });
  expect(byMsg["fx-m4"]).toMatchObject({ kind: "open", attributedTo: "quoted" }); // the pasted story line is not Brennan's decision
  expect(byMsg["fx-m6"]).toMatchObject({ kind: "open", attributedTo: "quoted" }); // nor is pasted text without quotation marks, when introduced as such

  await page.getByRole("button", { name: /^Project memory/ }).click();
  await expect(page.getByRole("heading", { name: /To review/ })).toBeVisible();
  await expect(page.locator(".memory-item")).toHaveCount(5);
  await expect(page.locator(".memory-item[data-kind='decision']")).toHaveCount(1);
  await expect(page.getByText("AI suggestion")).toHaveCount(1);
  await expect(page.getByText("quoted text")).toHaveCount(2);
  await expect(page.locator(".memory-scope")).toContainText("One shared project for the studio");
  // Capturing again proposes nothing new.
  const again = await request.post(`${base}/api/project/capture`, { headers: KEY, data: { entryId: FIXTURE_CHAT.id } });
  expect((await again.json()).proposed).toEqual([]);
});

test("a source link opens the conversation at the supporting message", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: /^Project memory/ }).click();
  const decision = page.locator(".memory-item[data-kind='decision']");
  await decision.getByRole("button", { name: /from “Planning the studio”/ }).click();
  await expect(page.locator("#message-fx-m1")).toHaveClass(/message-highlight/);
  await expect(page.locator("#message-fx-m1 .message-body")).toHaveText("Decision: the studio keeps one shared access key for now.");
});

test("review: accept, accept as edited, reject; only accepted items count", async ({ page, request }) => {
  await unlock(page);
  await page.getByRole("button", { name: /^Project memory/ }).click();
  const item = (messageQuote: RegExp) => page.locator(".memory-item").filter({ hasText: messageQuote });

  await item(/one shared access key/).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Decisions/ })).toBeVisible();

  const tentative = item(/Maybe a timeline/);
  await tentative.getByRole("button", { name: "Edit" }).click();
  await tentative.getByLabel("Memory text").fill("A timeline view is being considered; undecided.");
  await tentative.getByRole("button", { name: "Accept as edited" }).click();
  await expect(page.getByRole("heading", { name: /^Open/ })).toBeVisible();
  await expect(page.getByText("edited from the proposal")).toBeVisible();

  await item(/You could add a timeline/).getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText(/1 rejected/)).toBeVisible();

  const all = await memories(request);
  const accepted = all.filter((m) => m.status === "accepted");
  expect(accepted.map((m) => m.kind).sort()).toEqual(["decision", "open"]);
  expect(all.find((m) => m.source.messageId === "fx-m3")).toMatchObject({ text: "A timeline view is being considered; undecided." });
  expect(all.find((m) => m.source.messageId === "fx-m4")?.status).toBe("suggested"); // left unreviewed: still not established
  expect(all.find((m) => m.source.messageId === "fx-m6")?.status).toBe("suggested");
});

test("a fresh chat can say where the project was left, citing accepted memories only", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("textbox", { name: "Message Holographic" }).fill("Where did we leave this project?");
  await page.keyboard.press("Enter");
  const reply = page.locator(".message-assistant .message-body").last();
  await expect(reply).toContainText("[MD1]");
  await expect(reply).toContainText("[MO1]");
  await expect(reply).toContainText("Suggestion (mine, not a decision)");
  const chips = page.locator(".message-assistant").last().locator(".source-chip");
  await expect(chips).toHaveCount(2);
  const decisionChip = chips.filter({ hasText: /^Decision: / });
  await expect(decisionChip).toHaveCount(1);
  await decisionChip.click();
  await expect(page.locator(".memory-item-highlight")).toHaveCount(1);
  await expect(page.locator(".memory-item-highlight")).toContainText("one shared access key");
});

test("a correction supersedes the memory, survives a reload, and keeps its history", async ({ page, request }) => {
  await unlock(page);
  await page.getByRole("button", { name: /^Project memory/ }).click();
  const decision = page.locator(".memory-item[data-kind='decision'][data-status='accepted']");
  await decision.getByRole("button", { name: "Correct" }).click();
  await decision.getByLabel("Memory text").fill("The studio keeps one shared access key until Maggie's areas are built.");
  await decision.getByLabel("Correction note").fill("Clarified the time frame.");
  await decision.getByRole("button", { name: "Save correction" }).click();
  await expect(page.locator(".memory-item[data-kind='decision'][data-status='accepted']")).toContainText("until Maggie's areas are built");
  await expect(page.getByText("corrected", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /^Project memory/ }).click();
  const after = page.locator(".memory-item[data-kind='decision'][data-status='accepted']");
  await expect(after).toContainText("until Maggie's areas are built");
  await after.getByRole("button", { name: "History" }).click();
  const history = after.locator(".memory-history");
  await expect(history).toContainText("proposed: “the studio keeps one shared access key for now.”");
  await expect(history).toContainText("superseded: “the studio keeps one shared access key for now.” → “The studio keeps one shared access key until Maggie's areas are built.” — “Clarified the time frame.”");

  const all = await memories(request);
  expect(all.filter((m) => m.kind === "decision").map((m) => m.status).sort()).toEqual(["accepted", "superseded"]);

  // Recall after the reload uses the corrected wording.
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("textbox", { name: "Message Holographic" }).fill("Where did we leave this project?");
  await page.keyboard.press("Enter");
  const chips = page.locator(".message-assistant").last().locator(".source-chip");
  await expect(chips.filter({ hasText: /^Decision: / })).toHaveAttribute("title", "The studio keeps one shared access key until Maggie's areas are built.");
});

test("an unsupported question is answered honestly, and the original conversation is untouched", async ({ page, request }) => {
  await unlock(page);
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("textbox", { name: "Message Holographic" }).fill("What colour is the mayor's bicycle?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-assistant .message-body").last()).toContainText("don't know");
  await expect(page.locator(".message-assistant").last().locator(".source-chip")).toHaveCount(0);

  const { entry } = await (await request.get(`${base}/api/entries/${FIXTURE_CHAT.id}`, { headers: KEY })).json();
  expect(entry.messages.map((m: { id: string; content: string }) => [m.id, m.content])).toEqual(FIXTURE_CHAT.messages.map((m) => [m.id, m.content]));
});

test("when accepted memories exceed the limit, the omission is visible to the model, the reply, and the review", async ({ page, request }) => {
  // A long conversation of explicit decisions, each about 280 characters; a capture proposes at most 20, together well over 4,000 characters.
  const long = {
    id: "fixture-long-chat",
    kind: "chat",
    title: "Many decisions",
    createdAt: at(10),
    updatedAt: at(10),
    messages: Array.from({ length: 40 }, (_, i) => ({ id: `lx-m${i}`, role: "user", content: `Decision: item ${i} is settled, ` + "and the reasons are recorded here at some length ".repeat(5), createdAt: at(10) })),
  };
  expect((await request.post(`${base}/api/import`, { headers: KEY, data: { entries: [long], dryRun: false } })).status()).toBe(200);
  expect((await request.post(`${base}/api/project/capture`, { headers: KEY, data: { entryId: long.id } })).status()).toBe(200);
  for (const m of await memories(request)) {
    if (m.status === "suggested" && m.text.startsWith("item ")) await request.post(`${base}/api/memories/${m.id}/accept`, { headers: KEY, data: {} });
  }
  const project = await (await request.get(`${base}/api/project`, { headers: KEY })).json();
  expect(project.context.limit).toBe(4000);
  expect(project.context.omitted.length).toBeGreaterThan(0);
  expect(project.context.included.length + project.context.omitted.length).toBe(project.memories.filter((m: { status: string }) => m.status === "accepted").length);

  // The model is told exactly what it did not see.
  const r = await request.post(`${base}/api/chat`, { headers: KEY, data: { messages: [{ role: "user", content: "Where did we leave this project?" }] } });
  const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const memEvent = lines.find((l) => l.type === "memories");
  expect(memEvent.omitted).toBe(project.context.omitted.length);
  expect(memEvent.included).toBe(project.context.included.length);

  await unlock(page);
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("textbox", { name: "Message Holographic" }).fill("Where did we leave this project?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-assistant").last().locator(".message-omitted")).toContainText(`${project.context.omitted.length} accepted memories weren't given to the model`);
  await page.locator(".message-assistant").last().locator(".message-omitted").click();
  await expect(page.locator(".memory-scope")).toContainText(`${project.context.omitted.length} accepted memories are currently over that limit`);
  await expect(page.locator(".memory-omitted")).toHaveCount(project.context.omitted.length);
});

test.afterAll(async ({ request }) => {
  const { library } = await (await request.get(`${base}/api/entries`, { headers: KEY })).json();
  for (const e of library.entries as { id: string; title: string }[]) {
    if (e.id === FIXTURE_CHAT.id || e.id === "fixture-long-chat" || /Where did we leave|mayor's bicycle/.test(e.title)) await request.delete(`${base}/api/entries/${e.id}`, { headers: KEY });
  }
});
