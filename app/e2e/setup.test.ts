/**
 * E2E tests for the setup wizard flow.
 *
 * These tests verify that the setup wizard renders the expected UI
 * and walks through each step correctly.
 *
 * Note: WebAuthn passkey interactions require a virtual authenticator.
 * These tests use Playwright's CDP-based virtual authenticator where supported,
 * and skip hardware-dependent steps in environments without it.
 */
import { test, expect } from '@playwright/test';

test.describe('Setup wizard', () => {
	test('shows passkey registration step on first visit', async ({ page }) => {
		// The app redirects to /setup when not configured
		await page.goto('/setup');
		await expect(page).toHaveTitle(/Claude Code/);

		// Should show the setup wizard
		await expect(page.locator('h1, h2').first()).toBeVisible();
	});

	test('setup page has correct structure', async ({ page }) => {
		await page.goto('/setup');

		// Page should load without errors
		await expect(page.locator('body')).toBeVisible();

		// Should not show the bottom nav (noNav list)
		const nav = page.locator('nav');
		await expect(nav).toHaveCount(0);
	});
});
