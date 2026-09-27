// Headless smoke test: serves dist/, plays a few pitches in each mode through the
// ?test hook, checks for console errors and state changes, and saves screenshots.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const URL = `http://localhost:${PORT}/?test`;
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const errors = [];
let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed = true;
};

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Network failures for web fonts are expected in sandboxes; anything else is a real error.
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.waitForTimeout(1500);
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(tick) : resolve((n * 1000) / (performance.now() - t0)));
        requestAnimationFrame(tick);
      }),
  );
  console.log(`headless fps: ${fps.toFixed(1)}`);
  await page.screenshot({ path: `${OUT}/01-menu.png` });
  // Software rendering is slow; slow the game down so every phase gets rendered frames.
  const slow = Math.min(1, Math.max(0.1, fps / 40));
  await page.evaluate((s) => window.__game.setTimeScale(s), slow);

  // --- Batting practice ---
  await page.evaluate(() => window.__game.start({ role: 'batting', difficulty: 'pro', userHand: 'R', cpuHand: 'R' }));
  await page.evaluate(() => window.__game.setPlateLoc(0.1, 2.6));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/02-batting-view.png` });
  await page.waitForFunction(() => window.__game.snapshot().phase === 'flight', null, { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/03-batting-pitch-in-flight.png` });

  await page.evaluate(() => window.__game.setAuto(true));
  await page.waitForFunction(() => window.__game.snapshot().phase === 'inPlay', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-ball-in-play.png` });
  await page.waitForFunction(() => window.__game.snapshot().phase === 'result', null, { timeout: 60000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/05-result.png` });

  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.snapshot().batting.pa >= 5, null, { timeout: 180000 });
  const bat = await page.evaluate(() => window.__game.snapshot());
  console.log('batting snapshot', JSON.stringify(bat));
  check(bat.batting.pa >= 5, 'batting: plate appearances complete');
  check(bat.batting.maxEv > 60, 'batting: auto-swings make contact');

  // --- Pitching practice ---
  await page.evaluate(() => window.__game.start({ role: 'pitching', difficulty: 'pro', userHand: 'R', cpuHand: 'S' }));
  await page.evaluate(() => window.__game.setPlateLoc(0.3, 2.2));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/06-pitching-view.png` });
  // Drive the real meter with mouse clicks once.
  const box = await page.locator('#game').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/07-pitching-meter.png` });
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(550);
  await page.mouse.click(cx, cy);
  await page.evaluate((s) => window.__game.setTimeScale(s), slow);
  await page.waitForFunction(() => window.__game.snapshot().phase === 'flight', null, { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/08-pitching-flight.png` });
  await page.waitForFunction(() => window.__game.snapshot().pitches >= 1, null, { timeout: 30000 });
  check(true, 'pitching: a pitch thrown with real mouse clicks through the meter');
  await page.evaluate(() => window.__game.setTimeScale(1));

  await page.evaluate(() => window.__game.setAuto(true));
  await page.waitForFunction(() => window.__game.snapshot().pitching.pitches >= 25, null, { timeout: 180000 });
  const pit = await page.evaluate(() => window.__game.snapshot());
  console.log('pitching snapshot', JSON.stringify(pit));
  check(pit.pitching.pitches >= 25, 'pitching: pitches thrown');
  check(pit.pitching.k + pit.pitching.bb + pit.pitching.h + pit.pitching.outs > 0, 'pitching: plate appearances resolve');
  await page.screenshot({ path: `${OUT}/09-pitching-later.png` });

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
