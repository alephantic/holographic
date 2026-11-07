// Visual check: captures the main states at desktop and mobile widths using the installed Chrome.
// Usage: npm run dev (in another terminal), then `node scripts/screenshots.mjs`. Output: ./screenshots (or $SHOT_DIR).
import { chromium, devices } from "@playwright/test";
const out = process.env.SHOT_DIR ?? "screenshots";
const base = process.env.BASE_URL ?? "http://localhost:5173";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

async function shoot(name, { viewport, mobile = false, scheme = "light", steps }) {
  const ctx = await browser.newContext({
    ...(mobile ? devices["iPhone 14"] : { viewport }),
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForSelector(".composer");
  await page.waitForTimeout(300);
  if (steps) await steps(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  await ctx.close();
}

const desktop = { viewport: { width: 1440, height: 900 } };

await shoot("01-desktop-empty", desktop);
await shoot("02-desktop-empty-dark", { ...desktop, scheme: "dark" });
await shoot("03-desktop-menu", { ...desktop, steps: async (p) => { await p.click(".mode-trigger"); } });
await shoot("04-desktop-sample-chat", { ...desktop, steps: async (p) => { await p.click("text=Borrowing a sonata"); } });
await shoot("05-desktop-sample-saved", { ...desktop, steps: async (p) => { await p.click("text=A diagram that reads"); } });
await shoot("06-desktop-saved-flow", { ...desktop, steps: async (p) => {
  await p.click(".mode-trigger"); await p.click("text=Keep a thought");
  await p.fill(".composer-input", "Try the sonata idea on chapter three.\n\nTwo descriptions of the same room, then one object missing at the end.");
  await p.keyboard.press("Enter");
} });
await shoot("07-desktop-chat-unconfigured", { ...desktop, steps: async (p) => {
  await p.fill(".composer-input", "What should I try first?");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".message-note");
} });
await shoot("08-mobile-empty", { mobile: true });
await shoot("09-mobile-drawer", { mobile: true, steps: async (p) => { await p.click("[aria-label='Open sidebar']"); await p.waitForTimeout(300); } });
await shoot("10-mobile-sample-chat", { mobile: true, steps: async (p) => { await p.click("[aria-label='Open sidebar']"); await p.click("text=Borrowing a sonata"); } });
await shoot("11-mobile-menu-dark", { mobile: true, scheme: "dark", steps: async (p) => { await p.click(".mode-trigger"); } });
await browser.close();
console.log("done");
