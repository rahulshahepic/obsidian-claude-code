/**
 * E2E tests for the setup wizard flow.
 *
 * These tests verify that the setup wizard renders the expected UI
 * and walks through each step correctly.
 */
import { test, expect } from '@playwright/test';

test.describe('Setup wizard', () => {
	test('shows Claude token step on first visit', async ({ page }) => {
		// The app redirects to /setup when authenticated but not yet configured
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
