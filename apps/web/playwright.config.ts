import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

// One address for pages + API, with a throwaway in-memory database (like Netlify + Supabase, locally).
const PORT = Number(process.env.E2E_PORT ?? 3410);
const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromium = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: chromium ? { executablePath: chromium } : {} },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && cd ../api && npx tsx src/dev.ts`,
    url: `http://localhost:${PORT}/api/auth/me`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { API_PORT: String(PORT), PGLITE_DIR: 'memory', OWNER_PASSWORD: 'Diddy', DW_WORLD_EVENTS: 'off' },
  },
});
