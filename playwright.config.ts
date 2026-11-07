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
// A third pair runs against a real PostgreSQL database when
// HOLOGRAPHIC_TEST_DATABASE_URL is set (see db/README.md), behind an access key.
export const STUDIO_WEB_PORT = 5178;
const STUDIO_API_PORT = 8794;
export const STUDIO_ACCESS_KEY = "studio-db-key";
export const STUDIO_DATABASE_URL = process.env.HOLOGRAPHIC_TEST_DATABASE_URL;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Database-backed specs share one test database, so files must not run side by side.
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  globalSetup: STUDIO_DATABASE_URL ? "./e2e/studio.setup.ts" : undefined,
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" }, testIgnore: /(studio|memory)\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" }, testIgnore: /(studio|memory|gate)\.spec/ },
    ...(STUDIO_DATABASE_URL
      ? [{ name: "studio", use: { ...devices["Desktop Chrome"], channel: "chrome" }, testMatch: /(studio|memory)\.spec/ }]
      : []),
  ],
  webServer: [
    ...(STUDIO_DATABASE_URL
      ? [
          {
            command: `npx concurrently -k "vite --port ${STUDIO_WEB_PORT}" "tsx server/index.ts"`,
            url: `http://localhost:${STUDIO_WEB_PORT}`,
            env: {
              PORT: String(STUDIO_API_PORT),
              OPENAI_API_KEY: "sk-not-a-real-key",
              ANTHROPIC_API_KEY: "",
              HOLOGRAPHIC_ACCESS_KEY: STUDIO_ACCESS_KEY,
              DATABASE_URL: STUDIO_DATABASE_URL,
              DATABASE_URL_UNPOOLED: "",
              // Only honoured when the global setup has also accepted a remote *_test database.
              HOLOGRAPHIC_ALLOW_REMOTE_DB: process.env.HOLOGRAPHIC_ALLOW_REMOTE_TEST_DB === "1" ? "1" : "",
            },
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]
      : []),
    {
      command: `npx concurrently -k "vite --port ${WEB_PORT}" "tsx server/index.ts"`,
      url: `http://localhost:${WEB_PORT}`,
      // Blank every service variable so a developer's .env (model key, database) can't leak into these servers.
      env: { PORT: String(API_PORT), OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", HOLOGRAPHIC_ACCESS_KEY: "", DATABASE_URL: "", DATABASE_URL_UNPOOLED: "" },
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
        DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
