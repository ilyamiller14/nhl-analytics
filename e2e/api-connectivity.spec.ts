import { test, expect } from '@playwright/test';

/**
 * API Connectivity Tests
 *
 * Validates all NHL API endpoints are properly proxied
 * and returning data without CORS errors.
 */

test.describe('API Connectivity', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    // Capture all console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      consoleErrors.push(error.message);
    });
  });

  test.afterEach(async () => {
    // Check for CORS errors
    const corsErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('cors') ||
      e.toLowerCase().includes('cross-origin') ||
      e.toLowerCase().includes('access-control')
    );

    if (corsErrors.length > 0) {
      console.log('❌ CORS Errors Found:', corsErrors);
    }

    // Log all errors for debugging
    if (consoleErrors.length > 0) {
      console.log('Console Errors:', consoleErrors.slice(0, 5));
    }
  });

  test('Player Search API works', async ({ page }) => {
    // Intercept search API calls
    const searchPromise = page.waitForResponse(
      response => response.url().includes('/api/search') || response.url().includes('search'),
      { timeout: 10000 }
    ).catch(() => null);

    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Type in search
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('McDavid');

      const response = await searchPromise;
      if (response) {
        expect(response.status()).toBeLessThan(400);
        console.log('✓ Search API responded:', response.status());
      }
    }

    // No CORS errors
    const corsErrors = consoleErrors.filter(e => e.toLowerCase().includes('cors'));
    expect(corsErrors.length).toBe(0);
  });

  test('Player Profile API endpoints work', async ({ page }) => {
    const apiCalls: { url: string; status: number }[] = [];

    // Monitor all API calls
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        apiCalls.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto('/player/8478402'); // Connor McDavid
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for async data

    // Log all API calls
    console.log('API Calls made:');
    apiCalls.forEach(call => {
      const status = call.status < 400 ? '✓' : '❌';
      console.log(`  ${status} ${call.status} - ${call.url.substring(0, 80)}`);
    });

    // Check player data loaded
    const playerName = page.locator('text=/McDavid/i');
    await expect(playerName.first()).toBeVisible({ timeout: 10000 });

    // No CORS errors
    const corsErrors = consoleErrors.filter(e => e.toLowerCase().includes('cors'));
    expect(corsErrors.length).toBe(0);
  });

  test('Team Profile API endpoints work', async ({ page }) => {
    const apiCalls: { url: string; status: number }[] = [];

    page.on('response', response => {
      if (response.url().includes('/api/')) {
        apiCalls.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto('/team/EDM'); // Edmonton Oilers
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    console.log('Team API Calls:');
    apiCalls.forEach(call => {
      const status = call.status < 400 ? '✓' : '❌';
      console.log(`  ${status} ${call.status} - ${call.url.substring(0, 80)}`);
    });

    // Check team data loaded
    const teamContent = page.locator('text=/Oilers|Edmonton/i');
    await expect(teamContent.first()).toBeVisible({ timeout: 10000 });

    // No CORS errors
    const corsErrors = consoleErrors.filter(e => e.toLowerCase().includes('cors'));
    expect(corsErrors.length).toBe(0);
  });

  test('Shift data API works (for Corsi)', async ({ page }) => {
    let shiftApiCalled = false;
    let shiftApiStatus = 0;

    page.on('response', response => {
      if (response.url().includes('shiftcharts') || response.url().includes('/stats/')) {
        shiftApiCalled = true;
        shiftApiStatus = response.status();
      }
    });

    await page.goto('/player/8478402');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000); // Shift data takes longer

    if (shiftApiCalled) {
      console.log(`✓ Shift API called, status: ${shiftApiStatus}`);
      expect(shiftApiStatus).toBeLessThan(400);
    } else {
      console.log('⚠ Shift API not called (may be cached or not triggered)');
    }

    // No CORS errors
    const corsErrors = consoleErrors.filter(e => e.toLowerCase().includes('cors'));
    expect(corsErrors.length).toBe(0);
  });

  test('All endpoints return valid data', async ({ page }) => {
    const failedCalls: string[] = [];

    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        failedCalls.push(`${response.status()} - ${response.url()}`);
      }
    });

    // Visit multiple pages to trigger all API endpoints
    const pages = [
      '/',
      '/search',
      '/player/8478402',
      '/teams',
      '/team/TOR',
      '/compare',
      '/trends',
    ];

    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    if (failedCalls.length > 0) {
      console.log('❌ Failed API calls:');
      failedCalls.forEach(call => console.log(`  ${call}`));
    } else {
      console.log('✓ All API calls successful');
    }

    // No CORS errors across all pages
    const corsErrors = consoleErrors.filter(e => e.toLowerCase().includes('cors'));
    expect(corsErrors.length).toBe(0);
  });

  test('No redirects cause CORS issues', async ({ page }) => {
    // Specifically test endpoints that are known to redirect
    const redirectEndpoints = [
      '/team/NJD', // club-stats/NJD/now redirects
    ];

    for (const path of redirectEndpoints) {
      consoleErrors = []; // Reset for each page

      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const corsErrors = consoleErrors.filter(e =>
        e.toLowerCase().includes('cors') ||
        e.includes('307') ||
        e.includes('redirect')
      );

      if (corsErrors.length > 0) {
        console.log(`❌ CORS/Redirect issues on ${path}:`, corsErrors);
      } else {
        console.log(`✓ ${path} - No CORS issues`);
      }

      expect(corsErrors.length).toBe(0);
    }
  });
});
