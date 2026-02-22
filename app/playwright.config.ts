import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
	use: {
		baseURL: 'http://localhost:3000',
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'Mobile Chrome',
			use: { ...devices['Pixel 5'] }
		}
	],
	webServer: {
		command: 'npm run build && node build',
		url: 'http://localhost:3000',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			APP_SECRET: 'playwright-test-secret-32-chars-ok',
			ENCRYPTION_KEY: 'a'.repeat(64),
			DATABASE_URL: '/tmp/playwright-test.db',
			NODE_ENV: 'test',
			PORT: '3000'
		}
	}
});
