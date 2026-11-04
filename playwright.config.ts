import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4184', viewport: { width: 1440, height: 960 } },
  webServer: { command: 'npm run preview:synthetic', url: 'http://127.0.0.1:4184/', reuseExistingServer: false },
});
