import { test } from '@playwright/test';

const PLAYERS = [
  { id: 8480069, name: 'Makar' },
  { id: 8480800, name: 'QHughes' },
  { id: 8478048, name: 'Shesterkin' },
];

for (const p of PLAYERS) {
  test(`mobile inspection ${p.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.addInitScript(() => {
      // @ts-ignore
      delete (navigator as any).share;
      // @ts-ignore
      delete (navigator as any).canShare;
    });
    await page.goto(`http://localhost:5174/player/${p.id}?tab=card`);
    await page.waitForSelector('.player-analytics-card, .goalie-analytics-card', { timeout: 30000 });
    await page.waitForSelector('.war-history-strip', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.war-history-strip .wh-empty'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // On-page preview screenshot
    const preview = page.locator('.card-preview').first();
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await preview.screenshot({ path: `/tmp/share-card-test/mobile-${p.name}-preview.png` });

    // Download
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('button.share-btn');
    const download = await downloadPromise;
    await download.saveAs(`/tmp/share-card-test/mobile-${p.name}-download.png`);
  });
}
