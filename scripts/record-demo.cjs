/**
 * Records the demo video of the running app (npm run dev), timed to docs/pitch/pitch-script.md.
 *   node scripts/record-demo.cjs [outDir]   -> outDir/*.webm (convert with ffmpeg)
 * Needs Playwright with Chromium. Open each target once beforehand so its images are cached.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const CARDS = 'file://' + path.resolve(__dirname, '..', 'docs', 'pitch', 'cards');
const OUT = process.argv[2] || path.resolve(__dirname, '..', 'docs', 'pitch', 'video');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    acceptDownloads: true,
  });
  // A visible cursor and a caption strip (video only; not part of the app).
  await context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.id = '__cursor';
      c.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;background:rgba(216,53,42,.85);border:2px solid #fff;box-shadow:0 0 0 1px #000;pointer-events:none;left:-40px;top:-40px;transform:translate(-50%,-50%);transition:transform .08s';
      document.body.appendChild(c);
      document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; });
      document.addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)'; });
      document.addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%)'; });
      const cap = document.createElement('div');
      cap.id = '__caption';
      cap.style.cssText = 'position:fixed;z-index:99998;right:24px;bottom:24px;max-width:560px;background:#000;color:#fff;font:600 20px/1.35 Helvetica,Arial,sans-serif;padding:12px 16px;border-left:5px solid #d8352a;display:none';
      document.body.appendChild(cap);
    });
  });
  // Warm-up in a separate tab: both targets are loaded once so the browser cache serves them instantly.
  const warm = await context.newPage();
  for (const name of ["Barnard's Star", 'RW Aurigae']) {
    await warm.goto(APP);
    await warm.getByRole('button', { name: new RegExp('^' + name) }).click();
    await warm.waitForFunction(() => /(\d+) \/ \1 images loaded/i.test(document.body.innerText), null, { timeout: 600000 });
  }
  await warm.close();

  const page = await context.newPage();
  const t0 = Date.now();
  const until = async (s) => { const wait = t0 + s * 1000 - Date.now(); if (wait > 0) await page.waitForTimeout(wait); };
  const caption = (text) => page.evaluate((t) => { const c = document.getElementById('__caption'); if (!c) return; c.textContent = t; c.style.display = t ? 'block' : 'none'; }, text);
  const moveTo = async (locator) => { const b = await locator.boundingBox(); if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 }); };
  const click = async (locator) => { await moveTo(locator); await page.waitForTimeout(250); await locator.click(); };
  const loaded = () => page.waitForFunction(() => /(\d+) \/ \1 images loaded/i.test(document.body.innerText), null, { timeout: 300000 });

  // 0:00 Title
  await page.goto(`${CARDS}/title.html`);
  await until(8);

  // 0:08 The idea: the home page and its suggestions
  await page.goto(APP);
  await page.waitForSelector('.card');
  await caption('Pick a target — no astronomy needed');
  const cards = page.locator('.card');
  for (let i = 0; i < 5; i++) { await moveTo(cards.nth(i)); await page.waitForTimeout(3500); }
  await moveTo(page.locator('#q'));
  await until(38);

  // 0:38 Barnard's Star: play the visits
  await caption("Barnard's Star · one frame per six-month visit · real SPHEREx images");
  await click(page.getByRole('button', { name: /^Barnard's Star/ }));
  await loaded();
  await page.locator('canvas').first().evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await page.waitForTimeout(1500);
  await moveTo(page.locator('canvas').first());
  await until(60);

  // 1:00 Compare two visits
  await caption('Compare · August 2025 next to August 2026');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await click(page.getByRole('button', { name: 'Compare', exact: true }));
  await page.waitForTimeout(6000);
  await click(page.getByRole('button', { name: 'Blink', exact: true }));
  await caption('Blink between the two visits');
  await page.waitForTimeout(8000);
  await click(page.getByRole('button', { name: 'Difference', exact: true }));
  await caption('Difference · white = brighter now · black = fainter now → the star moved north');
  await until(84);

  // 1:24 Read the light: spectrum on the fly
  await caption('RW Aurigae · click a pixel → its spectrum, one point per image');
  await click(page.getByRole('button', { name: 'Explore', exact: true }));
  await click(page.getByRole('button', { name: /^RW Aurigae/ }));
  await loaded();
  await page.locator('canvas').first().evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await page.waitForTimeout(1200);
  const cv = page.locator('canvas').first();
  const b = await cv.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(800);
  await page.locator('section[aria-labelledby="s3"]').evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  await page.waitForTimeout(1500);
  await moveTo(page.locator('section[aria-labelledby="s3"] svg[role=img]').first());
  await caption('Colours = visits · if they disagree, the star changed');
  await until(114);

  // 1:54 Share and trust
  await caption('Save a frame or an animated GIF · share a link that reopens this view');
  await page.locator('canvas').first().evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await page.waitForTimeout(1200);
  await click(page.getByRole('button', { name: 'Save GIF', exact: true }));
  await page.waitForTimeout(4000);
  await caption('Every number has its source · nothing is filled in');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await click(page.getByRole('button', { name: 'About the data' }));
  await until(138);

  // 2:18 Closing
  await page.goto(`${CARDS}/end.html`);
  await until(148);

  const video = page.video();
  await (await warm.video())?.delete().catch(() => {});
  await context.close();
  console.log('video:', await video.path(), 'duration ~', Math.round((Date.now() - t0) / 1000), 's');
  await browser.close();
})();
