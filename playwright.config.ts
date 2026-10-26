import { defineConfig, devices } from "@playwright/test";

// BASE_URL=http://localhost:5173 npm run test:e2e runs the same tests against the dev server (StrictMode on)
const external = process.env.BASE_URL;
// PREVIEW_PORT moves the production preview off 4173 where Windows has reserved it (Hyper-V/WSL port ranges)
const port = Number(process.env.PREVIEW_PORT ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: external ?? `http://localhost:${port}` },
  expect: { timeout: 8000 },   // the fan winds up for a few seconds before it reaches its note
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: external ? undefined : {
    command: `npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
