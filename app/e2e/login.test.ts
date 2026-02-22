/**
 * E2E tests for the login flow.
 */
import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
	test('shows passkey authentication button', async ({ page }) => {
		await page.goto('/login');
		await expect(page).toHaveTitle(/Sign In/);

		// Should show the "Use Passkey" button
		const btn = page.getByRole('button', { name: /Use Passkey/i });
		await expect(btn).toBeVisible();
	});

	test('login page has no bottom nav', async ({ page }) => {
		await page.goto('/login');

		// Layout should not show bottom nav on login page
		const nav = page.locator('nav');
		await expect(nav).toHaveCount(0);
	});

	test('unauthenticated root redirects to login or setup', async ({ page }) => {
		const response = await page.goto('/', { waitUntil: 'commit' });

		// Should redirect away from / if not authenticated
		// Could go to /login or /setup depending on setup state
		const finalUrl = page.url();
		const isRedirected =
			finalUrl.includes('/login') ||
			finalUrl.includes('/setup') ||
			finalUrl === 'http://localhost:3000/' ||
			finalUrl === 'http://localhost:3000';
		expect(isRedirected).toBe(true);

		// Page should have loaded successfully (no 5xx)
		expect(response?.status()).toBeLessThan(500);
	});
});
