import { defineConfig } from '@playwright/test';

const baseURL = process.env.CUSTOMER_REVIEW_BASE_URL ?? 'http://orderweeddc.localhost:3000';
const executablePath = process.env.CUSTOMER_REVIEW_BROWSER || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: 'customer-sovereign-ui.browser.mjs',
  workers: 1,
  reporter: 'line',
  timeout: 90_000,
  use: {
    baseURL,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
});
