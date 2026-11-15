/**
 * Records the 30-second demo video of the running app (npm run dev), timed to docs/pitch/pitch-script-30s.md.
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
      cap.style.cssText = 'position:fixed;z-index:99998;left:50%;transform:translateX(-50%);bottom:22px;max-width:1120px;width:max-content;background:rgba(0,0,0,.82);color:#fff;font:600 26px/1.3 Helvetica,Arial,sans-serif;padding:10px 18px;text-align:center;display:none';
      document.body.appendChild(cap);
    });
  });
  // Warm-up in a separate tab: both targets are loaded once so the browser cache serves them instantly.
  const warm = await context.newPage();
  for (const name of ["Barnard's Star"]) {
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

  // Subtitles = the narration (required in English if the speaker uses another language).
  const SPEAKER = process.env.SPEAKER;
  const TEAM = process.env.TEAM;
  const intro = SPEAKER && TEAM ? `Hi! I'm ${SPEAKER}, team ${TEAM}.` : TEAM ? `Hi! We're team ${TEAM}.` : 'Hi! We are the SPHEREx Sky Motion team.';
  const sub = async (text) => { await caption(text); };

  // 0:00 Who we are + 0:02 the challenge + 0:05 the project
  await page.goto(`${CARDS}/title30.html`);
  await sub(intro);
  await until(2);
  await sub("Our challenge: spot what moves in NASA's SPHEREx sky maps.");
  await until(5);

  // 0:05 Project name and tagline, on the real site
  await page.goto(APP);
  await page.waitForSelector('.card');
  await sub('SPHEREx Sky Motion: watch the infrared sky move.');
  await click(page.getByRole('button', { name: /^Barnard's Star/ }));
  await loaded();
  await page.locator('canvas').first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await until(10);

  // 0:10 How it works, with NASA data
  await sub('Pick a target: we play real SPHEREx images, one per six-month visit.');
  await moveTo(page.locator('canvas').first());
  await until(14);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Difference', exact: true }).click();
  await sub("Subtract two visits: Barnard's Star moved north in one year.");
  await moveTo(page.locator('canvas').first());
  await until(18);
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  // Barnard's Star is still loaded; its saturated core is flagged, so pick a pixel in its halo.
  const cv = page.locator('canvas').first();
  await cv.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const bb = await cv.boundingBox();
  const px = bb.width / 29;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 2.5 * px, { steps: 12 });
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2 - 2.5 * px);
  await page.locator('section[aria-labelledby="s3"]').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await sub('Click a star for its spectrum, built from NASA data on the fly.');
  await moveTo(page.locator('section[aria-labelledby="s3"] svg[role=img]').first());
  await until(22);

  // 0:22 The future
  await page.goto(`${CARDS}/future30.html`);
  await sub('Next: anyone can hunt new brown dwarfs and asteroids, and every SPHEREx release adds frames.');
  await until(30);

  const video = page.video();
  await (await warm.video())?.delete().catch(() => {});
  await context.close();
  console.log('video:', await video.path(), 'duration ~', Math.round((Date.now() - t0) / 1000), 's');
  await browser.close();
})();
