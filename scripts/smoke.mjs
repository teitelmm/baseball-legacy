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
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.snapshot().phase === 'result', null, { timeout: 90000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/05-result.png` });

  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.snapshot().batting.pa >= 5, null, { timeout: 180000 });
  const bat = await page.evaluate(() => window.__game.snapshot());
  console.log('batting snapshot', JSON.stringify(bat));
  check(bat.batting.pa >= 5, 'batting: plate appearances complete');
  check(bat.batting.maxEv > 60, 'batting: auto-swings make contact');

  // --- Rookie: a swing clicked 60 ms after the ball crosses the plate still connects ---
  await page.evaluate(() => window.__game.start({ role: 'batting', difficulty: 'rookie', userHand: 'R', cpuHand: 'R' }));
  await page.evaluate(() => window.__game.setPlateLoc(0.2, 2.4));
  await page.evaluate((s) => window.__game.setTimeScale(s), slow);
  // SWING_TIME is 90 ms, so a timing error of +150 ms means clicking 60 ms after the ball arrives.
  await page.evaluate(() => window.__game.setAuto(true, 150));
  await page.waitForFunction(() => window.__game.snapshot().phase === 'flight', null, { timeout: 60000 });
  await page.screenshot({ path: `${OUT}/05b-rookie-guide.png` });
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.snapshot().phase === 'result', null, { timeout: 90000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05c-rookie-result.png` });
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.snapshot().batting.pa >= 3, null, { timeout: 180000 });
  const rookie = await page.evaluate(() => window.__game.snapshot());
  console.log('rookie late-swing snapshot', JSON.stringify(rookie));
  check(rookie.batting.maxEv > 40 && rookie.batting.k === 0, 'rookie: late swings still make contact');

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

  // --- Full games ---
  const finalBox = async (name) => {
    await page.waitForFunction(() => window.__game.snapshot()?.moment === 'final', null, { timeout: 60000 });
    const g = await page.evaluate(() => window.__game.snapshot());
    console.log(`${name} final`, JSON.stringify(g));
    check(g.over && g.score.home !== g.score.away, `${name}: game ends with a winner`);
    check(g.score.home === g.boxRuns.home && g.score.away === g.boxRuns.away, `${name}: box score matches the line score`);
    return g;
  };

  // DH: recap screen, then an at-bat.
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.evaluate(() => window.__game.startGame({ role: 'DH', bats: 'R', throws: 'R', difficulty: 'rookie', innings: 3, home: true }));
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'recap', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/10-game-recap.png` });
  await page.evaluate(() => window.__game.setAuto(true));
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'bat', null, { timeout: 60000 });
  await page.evaluate((s) => window.__game.setTimeScale(s), slow);
  await page.waitForFunction(() => window.__game.snapshot()?.phase === 'inPlay', null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/11-game-live-play.png` });
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'recap', null, { timeout: 120000 });
  check(true, 'DH: an at-bat played live and returned to the recap');
  await page.evaluate(() => window.__game.simToEnd());
  await finalBox('DH');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/12-box-score.png` });

  // P: pitch live until the half inning ends, then sim.
  await page.evaluate(() => window.__game.startGame({ role: 'P', bats: 'R', throws: 'R', difficulty: 'pro', innings: 3, home: false }));
  await page.evaluate(() => window.__game.setAuto(true));
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'pitch', null, { timeout: 60000 });
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'recap' || window.__game.snapshot()?.moment === 'final', null, { timeout: 240000 });
  check(true, 'P: pitched a live half inning');
  await page.evaluate(() => window.__game.simToEnd());
  await finalBox('P');

  // CF: wait for a ball hit to you, field it automatically.
  await page.evaluate(() => window.__game.startGame({ role: 'CF', bats: 'L', throws: 'R', difficulty: 'pro', innings: 9, home: true, seed: 11 }));
  await page.evaluate(() => window.__game.setAuto(true));
  const gotField = await page
    .waitForFunction(() => window.__game.snapshot()?.moment === 'field', null, { timeout: 400000 })
    .then(() => true)
    .catch(() => false);
  check(gotField, 'CF: a ball was hit your way');
  if (gotField) {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/13-fielding-cam.png` });
    await page.waitForFunction(() => window.__game.snapshot()?.moment !== 'field', null, { timeout: 120000 });
    check(true, 'CF: the fielding play finished');
  }
  await page.evaluate(() => window.__game.simToEnd());
  await finalBox('CF');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
