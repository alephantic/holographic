import { defineConfig, devices } from "@playwright/test";

// Uses the Chrome already installed on this machine (channel: "chrome"),
// so no separate browser download is needed. The test servers run on their
// own ports with model keys blanked, so the suite always exercises the
// "no model connected" state regardless of what is in .env.
const WEB_PORT = 5174;
const API_PORT = 8788;
// A second pair runs "locked": a (fake) model key plus an access key, so the
// unlock flow and the gate can be tested without spending anything.
export const LOCKED_WEB_PORT = 5175;
const LOCKED_API_PORT = 8789;
export const LOCKED_ACCESS_KEY = "studio-test-key";
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
  webServer: [
    {
      command: `npx concurrently -k "vite --port ${WEB_PORT}" "tsx server/index.ts"`,
      url: `http://localhost:${WEB_PORT}`,
      env: { PORT: String(API_PORT), OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", HOLOGRAPHIC_ACCESS_KEY: "" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx concurrently -k "vite --port ${LOCKED_WEB_PORT}" "tsx server/index.ts"`,
      url: `http://localhost:${LOCKED_WEB_PORT}`,
      env: {
        PORT: String(LOCKED_API_PORT),
        OPENAI_API_KEY: "sk-not-a-real-key",
        ANTHROPIC_API_KEY: "",
        HOLOGRAPHIC_ACCESS_KEY: LOCKED_ACCESS_KEY,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
