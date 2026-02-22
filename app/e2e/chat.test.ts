/**
 * E2E tests for the chat UI.
 *
 * These tests verify the chat page structure and interactive elements.
 * Full end-to-end chat tests (send message → receive response) require
 * an authenticated session with a valid Claude token — those are marked
 * as skip in CI and intended to run against a live server.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/** Helper to inject a fake session cookie so the app treats us as authenticated. */
async function injectFakeAuth(context: BrowserContext) {
	// The real session cookie is HMAC-signed; this helper is a placeholder
	// for environments where a test server is seeded with known credentials.
	// In production E2E runs, replace this with actual login steps.
	await context.addCookies([
		{
			name: 'session',
			value: 'test-session-placeholder',
			domain: 'localhost',
			path: '/',
			httpOnly: true,
			secure: false
		}
	]);
}

test.describe('Chat page structure', () => {
	test('chat page HTML is served', async ({ page }) => {
		// Even if we get redirected to login, the server should respond
		const response = await page.goto('/');
		expect(response?.status()).toBeLessThan(500);
	});

	test('login page has correct title and button', async ({ page }) => {
		await page.goto('/login');
		await expect(page).toHaveTitle(/Sign In — Claude Code/);
		await expect(page.getByRole('button', { name: /Use Passkey/i })).toBeVisible();
	});
});

test.describe('Chat UI components (with auth)', () => {
	test.skip('chat page renders message list and input bar', async ({ page, context }) => {
		// Skip: requires authenticated session with configured app.
		// To run locally: start the app, complete setup, then re-enable.
		await injectFakeAuth(context);
		await page.goto('/');
		await expect(page.locator('textarea')).toBeVisible();
	});

	test.skip('sending a message adds it to the chat list', async ({ page, context }) => {
		await injectFakeAuth(context);
		await page.goto('/');

		const textarea = page.locator('textarea');
		await textarea.fill('Hello, Claude!');
		await page.keyboard.press('Enter');

		// User message should appear
		await expect(page.locator('text=Hello, Claude!')).toBeVisible();
	});

	test.skip('permission prompt appears and can be approved', async ({ page, context }) => {
		// This test requires a live session that triggers a permission request.
		await injectFakeAuth(context);
		await page.goto('/');

		const textarea = page.locator('textarea');
		await textarea.fill('Run: echo test');
		await page.keyboard.press('Enter');

		// Wait for permission prompt
		const approveBtn = page.getByRole('button', { name: /Allow/i });
		await expect(approveBtn).toBeVisible({ timeout: 15_000 });
		await approveBtn.click();

		// Permission prompt should disappear
		await expect(approveBtn).not.toBeVisible();
	});
});
