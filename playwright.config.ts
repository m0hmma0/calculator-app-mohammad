import { defineConfig, devices } from '@playwright/test';

const STATIC_PORT = 4173;
const BACKEND_PORT = 8788;
const isCI = !!process.env.CI;

// Sandboxes and CI images sometimes ship a Chromium that predates the pinned
// Playwright version. Point PLAYWRIGHT_CHROMIUM_EXECUTABLE at it to reuse it
// instead of downloading a second copy; unset, Playwright resolves its own.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launchOptions = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Every test starts with the object list switched on: the specs read the board
  // through it. Tests of a first visit opt out with an empty storage state.
  use: { trace: 'on-first-retry', storageState: 'tests/e2e/prefs.json' },

  projects: [
    {
      // The canvas, which needs no backend at all.
      name: 'canvas',
      testIgnore: /(workspace|storage|collab|sharing|workshop|settings|classroom)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...launchOptions,
        baseURL: `http://localhost:${STATIC_PORT}`,
      },
    },
    {
      // Accounts, folders and boards, against the real Worker on local D1 and R2.
      name: 'workspace',
      testMatch: /(workspace|storage|collab|sharing|workshop|settings|classroom)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...launchOptions,
        baseURL: `http://localhost:${BACKEND_PORT}`,
      },
    },
  ],

  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${STATIC_PORT} --strictPort`,
      url: `http://localhost:${STATIC_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      // The canvas tests run the signed-out local board. A developer's .env would turn
      // this build into a sign-in page; variables set here take precedence over it.
      env: {
        VITE_FIREBASE_API_KEY: '',
        VITE_FIREBASE_AUTH_DOMAIN: '',
        VITE_FIREBASE_PROJECT_ID: '',
      },
    },
    {
      command: 'node scripts/test-backend.mjs',
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
  ],
});
