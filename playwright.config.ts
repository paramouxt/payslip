import { defineConfig, devices } from '@playwright/test';

const port = 3101;
const baseURL = `http://127.0.0.1:${port.toString()}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm dev -- --hostname 127.0.0.1 --port ${port.toString()}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DEV_AUTH_EMAIL: process.env.DEV_AUTH_EMAIL ?? 'e2e@example.test',
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        'e2e-only-auth-secret-that-is-long-enough-and-never-used-in-production',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
