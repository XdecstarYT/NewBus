import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A fresh database for every run; the server serves the built web app.
const db = path.join(os.tmpdir(), `dw-e2e-${Date.now()}.db`);
const PORT = Number(process.env.E2E_PORT ?? 3410);
// Use a pre-installed Chromium when there is one (CI images, cloud sandboxes).
const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromium = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /player\.spec/ },
  ],
  webServer: {
    command: `npm run build && cd ../server && npx tsx src/index.ts`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DATABASE_PATH: db, NODE_ENV: 'development', SEED_DEMO: 'true', OWNER_PASSWORD: 'Diddy', BACKUP_EVERY_HOURS: '0', LOG_LEVEL: 'warn' },
  },
});
