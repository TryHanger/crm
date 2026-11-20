import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'python -m uvicorn apps.api.app.main:app --host 127.0.0.1 --port 8000',
      port: 8000,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'npm run dev --workspace=@crm/booking-web -- --port 3000',
      port: 3000,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'npm run dev --workspace=@crm/business-crm -- --port 3001',
      port: 3001,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'npm run dev --workspace=@crm/platform-console -- --port 3002 --host 127.0.0.1',
      port: 3002,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
