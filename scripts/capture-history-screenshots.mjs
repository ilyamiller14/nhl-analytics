/**
 * Capture screenshots of the WAR History Strip on share card + deep tab.
 * Run: node scripts/capture-history-screenshots.mjs
 * Vite dev server must be running on http://localhost:5174.
 *
 * Outputs: /tmp/share-card-test/history-{playerId}-{type}.png
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = '/tmp/share-card-test';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function snap(label, url, viewport = { width: 393, height: 851 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[PAGEERR ${label}]`, e.message));
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      console.log(`[CONSOLE ${label} ${t}]`, m.text().slice(0, 250));
    }
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    console.log(`[NAV ${label}]`, e.message);
  }
  await page.waitForTimeout(5000);
  const out = `${OUT}/history-${label}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`saved ${out}`);
  await ctx.close();
}

await snap('8480069-card', 'http://localhost:5174/player/8480069?tab=card');
await snap('8480069-deep', 'http://localhost:5174/player/8480069?tab=deep');
await snap('8478048-card', 'http://localhost:5174/player/8478048?tab=card');
await snap('8478048-deep', 'http://localhost:5174/player/8478048?tab=deep');

// Higher-res desktop captures so the small visuals are legible.
async function snapDesktop(label, url) {
  return snap(label + '-desktop', url, { width: 1280, height: 1800 });
}
await snapDesktop('8480069-card', 'http://localhost:5174/player/8480069?tab=card');
await snapDesktop('8480069-deep', 'http://localhost:5174/player/8480069?tab=deep');
await snapDesktop('8478048-card', 'http://localhost:5174/player/8478048?tab=card');
await snapDesktop('8478048-deep', 'http://localhost:5174/player/8478048?tab=deep');

await browser.close();
console.log('done');
