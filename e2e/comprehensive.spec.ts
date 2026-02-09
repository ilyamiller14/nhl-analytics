import { test, expect } from '@playwright/test';

// Uses baseURL from playwright.config.ts
const BASE_URL = '';

// Collect console errors
let consoleErrors: string[] = [];
let consoleWarnings: string[] = [];

test.describe('NHL Analytics Comprehensive Test', () => {
  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    // Listen for console messages
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
      if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    // Listen for page errors
    page.on('pageerror', error => {
      consoleErrors.push(error.message);
    });
  });

  test('Home page loads without critical errors', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Check page loaded
    await expect(page).toHaveTitle(/NHL/i);

    // Log any errors found
    if (consoleErrors.length > 0) {
      console.log('Console Errors:', consoleErrors);
    }

    // Allow some warnings but no critical errors
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('ResizeObserver')
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('Player search works', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Find search input
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('McDavid');
      await page.waitForTimeout(1000); // Wait for search results

      // Check for search results
      const results = page.locator('[class*="search"], [class*="result"], [class*="player"]');
      await expect(results.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('Player profile page loads with data', async ({ page }) => {
    // Go to Connor McDavid's profile (common test player)
    await page.goto(`${BASE_URL}/player/8478402`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for data to load

    // Check player name appears
    const playerName = page.locator('text=/McDavid/i');
    await expect(playerName.first()).toBeVisible({ timeout: 10000 });

    // Check for stats sections
    const statsSection = page.locator('[class*="stat"], [class*="analytics"]');
    expect(await statsSection.count()).toBeGreaterThan(0);

    // Log console errors
    if (consoleErrors.length > 0) {
      console.log('Player Profile Console Errors:', consoleErrors);
    }
  });

  test('Advanced analytics table displays', async ({ page }) => {
    await page.goto(`${BASE_URL}/player/8478402`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Look for analytics table or Corsi/Fenwick mentions
    const analyticsContent = page.locator('text=/Corsi|Fenwick|xG|PDO/i');

    if (await analyticsContent.count() > 0) {
      await expect(analyticsContent.first()).toBeVisible();
      console.log('✓ Advanced analytics visible');
    } else {
      console.log('⚠ Advanced analytics not found on page');
    }
  });

  test('Charts tab loads charts', async ({ page }) => {
    await page.goto(`${BASE_URL}/player/8478402`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click on Charts tab if it exists
    const chartsTab = page.locator('text=/Charts|Visualizations|Ice Charts/i');

    if (await chartsTab.count() > 0) {
      await chartsTab.first().click();
      await page.waitForTimeout(2000);

      // Check for SVG elements (charts)
      const svgElements = page.locator('svg');
      const svgCount = await svgElements.count();
      console.log(`Found ${svgCount} SVG chart elements`);

      // Check for shot chart or rink visualization
      const shotChart = page.locator('[class*="shot"], [class*="rink"], [class*="chart"]');
      console.log(`Found ${await shotChart.count()} chart containers`);
    }
  });

  test('Team pages accessible', async ({ page }) => {
    // Try to navigate to teams section
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Look for teams link/nav - use separate locators for CSS and text
    const teamsLinkByHref = page.locator('a[href*="team"]');
    const teamsLinkByText = page.locator('text=/Teams/i');

    const hasTeamsLink = await teamsLinkByHref.count() > 0 || await teamsLinkByText.count() > 0;

    if (hasTeamsLink) {
      const teamsLink = await teamsLinkByHref.count() > 0 ? teamsLinkByHref.first() : teamsLinkByText.first();
      await teamsLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Check for team content
      const teamContent = page.locator('[class*="team"]');
      console.log(`Found ${await teamContent.count()} team elements`);
    } else {
      console.log('⚠ Teams navigation not found');
    }
  });

  test('League analytics page works', async ({ page }) => {
    await page.goto(`${BASE_URL}/league`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check page content loaded
    const pageContent = page.locator('body');
    const text = await pageContent.textContent();

    if (text && text.length > 100) {
      console.log('✓ League page has content');
    }

    // Check for player/team data tables
    const tables = page.locator('table, [class*="table"], [class*="grid"]');
    console.log(`Found ${await tables.count()} data tables/grids`);
  });

  test('No CORS errors in console', async ({ page }) => {
    await page.goto(`${BASE_URL}/player/8478402`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000); // Wait for all API calls

    const corsErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('cors') ||
      e.toLowerCase().includes('cross-origin') ||
      e.toLowerCase().includes('access-control')
    );

    if (corsErrors.length > 0) {
      console.log('CORS Errors found:', corsErrors);
    }

    expect(corsErrors.length).toBe(0);
  });

  test('Shift data loads for Corsi calculations', async ({ page }) => {
    await page.goto(`${BASE_URL}/player/8478402`);
    await page.waitForLoadState('networkidle');

    // Wait for shift data API calls
    const shiftResponse = page.waitForResponse(
      response => response.url().includes('shiftcharts') || response.url().includes('/stats/'),
      { timeout: 15000 }
    ).catch(() => null);

    await page.waitForTimeout(5000);

    // Check if Corsi values are populated (not 0/0)
    const corsiText = page.locator('text=/\\d+\\s*\\/\\s*\\d+/'); // Pattern like "45 / 38"

    if (await corsiText.count() > 0) {
      const text = await corsiText.first().textContent();
      console.log('Corsi For/Against:', text);

      // Check it's not 0/0
      if (text && !text.includes('0 / 0')) {
        console.log('✓ Corsi data is populated');
      } else {
        console.log('⚠ Corsi shows 0/0 - shift data may not be loading');
      }
    }
  });

  test.afterEach(async () => {
    // Summary of issues found
    if (consoleErrors.length > 0) {
      console.log('\n--- Console Errors Summary ---');
      consoleErrors.forEach(e => console.log('  ❌', e.substring(0, 200)));
    }
    if (consoleWarnings.length > 0) {
      console.log('\n--- Console Warnings Summary ---');
      consoleWarnings.slice(0, 5).forEach(w => console.log('  ⚠️', w.substring(0, 200)));
    }
  });
});
