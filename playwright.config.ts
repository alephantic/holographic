import { defineConfig, devices } from "@playwright/test";

// Uses the Chrome already installed on this machine (channel: "chrome"),
// so no separate browser download is needed. The test servers run on their
// own ports with model keys blanked, so the suite always exercises the
// "no model connected" state regardless of what is in .env.
const WEB_PORT = 5174;
const API_PORT = 8788;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `npx concurrently -k "vite --port ${WEB_PORT}" "tsx server/index.ts"`,
    url: `http://localhost:${WEB_PORT}`,
    env: { PORT: String(API_PORT), OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
