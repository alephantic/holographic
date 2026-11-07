import { expect, test } from "@playwright/test";
import { LOCKED_ACCESS_KEY, LOCKED_WEB_PORT } from "../playwright.config";

const base = `http://localhost:${LOCKED_WEB_PORT}`;

test("the server refuses chat without the access key", async ({ request }) => {
  const body = { messages: [{ role: "user", content: "hi" }] };
  const noKey = await request.post(`${base}/api/chat`, { data: body });
  expect(noKey.status()).toBe(401);
  expect(await noKey.json()).toMatchObject({ type: "error", code: "unauthorized" });

  const wrongKey = await request.post(`${base}/api/chat`, { data: body, headers: { "x-holographic-key": "wrong" } });
  expect(wrongKey.status()).toBe(401);

  // With the right key the gate opens; the fake model key then fails upstream, so nothing is spent.
  const rightKey = await request.post(`${base}/api/chat`, { data: body, headers: { "x-holographic-key": LOCKED_ACCESS_KEY } });
  expect(rightKey.status()).toBe(200);
  expect(await rightKey.text()).toContain('"code":"upstream"');

  const status = await (await request.get(`${base}/api/status`)).json();
  expect(status).toMatchObject({ configured: true, accessRequired: true });
});

test("the interface asks for the key once, rejects a wrong one, and remembers a right one", async ({ page }) => {
  await page.goto(base);
  const gate = page.getByRole("form", { name: "Access key" });
  await expect(gate).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeDisabled();

  await page.getByRole("textbox", { name: "Access key" }).fill("wrong");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toHaveText("That key wasn't accepted.");

  await page.getByRole("textbox", { name: "Access key" }).fill(LOCKED_ACCESS_KEY);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Replies come from");

  // Still unlocked after a reload; Save never needed the key.
  await page.reload();
  await expect(page.getByRole("form", { name: "Access key" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mode: Chat" }).click();
  await page.getByRole("option", { name: /^Save/ }).click();
  await expect(page.getByRole("status")).toContainText("Saved entries stay in this browser.");
});
