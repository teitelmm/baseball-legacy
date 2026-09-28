// Headless season smoke test: create a two-way player, start a short season, play one
// game from each role through the real hub UI, spend skill points, sim to a champion.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4180;
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.waitForTimeout(1000);

  // Two-way player (P + CF).
  await page.click('[data-a=create]');
  await page.fill('#first-name', 'Jamie');
  await page.fill('#last-name', 'Rivera');
  await page.click('#position [data-v=TW]');
  await page.click('#hit-spot [data-v=CF]');
  await page.click('[data-a=save]');
  await page.waitForTimeout(500);

  // New season: 20 games, 3 innings.
  await page.click('[data-a=season]');
  await page.click('#season-length [data-v="20"]');
  await page.click('#season-innings [data-v="3"]');
  await page.click('#season-difficulty [data-v=rookie]');
  await page.screenshot({ path: `${OUT}/20-season-setup.png` });
  await page.click('[data-a=season-start]');
  await page.waitForSelector('.next-card');
  await page.screenshot({ path: `${OUT}/21-season-hub.png` });
  const card = await page.textContent('.nc-detail');
  check(/mound/.test(card ?? ''), `day 1: two-way ace starts on the mound (${card})`);

  const season = () => page.evaluate(() => window.__game.season());
  const hubBack = () => page.waitForSelector('.overlay.season .next-card, .overlay.season .awards', { state: 'visible', timeout: 300000 });

  // Day 1: pitch live, then leave through the pause menu (the game is simmed and still counts).
  await page.click('[data-a=season-play]');
  await page.evaluate(() => window.__game.setAuto(true));
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'pitch', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  const restartHidden = await page.$eval('.pause [data-a=restart]', (e) => getComputedStyle(e).display === 'none');
  check(restartHidden, 'season pause menu hides Restart');
  await page.click('.pause [data-a=quit]');
  await hubBack();
  let s = await season();
  check(s.log.length === 1 && s.day === 1, `day 1 recorded after leaving (log ${s.log.length}, day ${s.day})`);
  check(s.games.filter((g) => g.day === 0 && g.result).length === 4, 'all four day-1 games have results');
  check(/IP/.test(s.log[0].line), `day 1: your pitching line (${s.log[0].line})`);
  const banner1 = await page.textContent('.season-banner');
  check(/skill point/.test(banner1 ?? ''), `post-game banner shows points (${banner1})`);

  // Day 2: play CF, sim the rest, Continue from the box score.
  const card2 = await page.textContent('.nc-detail');
  check(/play CF/.test(card2 ?? ''), `day 2: playing CF (${card2})`);
  await page.click('[data-a=season-play]');
  await page.waitForFunction(() => window.__game.snapshot()?.moment === 'recap' || window.__game.snapshot()?.moment === 'bat', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/22-season-game-recap.png` });
  await page.evaluate(() => window.__game.simToEnd());
  await page.waitForSelector('.boxscore [data-a=again]');
  const cont = await page.textContent('.boxscore [data-a=again]');
  check(cont?.trim() === 'Continue', 'season box score offers Continue');
  await page.click('.boxscore [data-a=again]');
  await hubBack();
  s = await season();
  check(s.log.length === 2 && s.day === 2 && !/IP/.test(s.log[1].line), `day 2 recorded as a hitter (${s.log[1]?.line})`);

  // Sim a day, then spend points.
  await page.click('[data-a=season-sim-game]');
  await page.waitForFunction(() => window.__game.season().day === 3);
  await page.waitForSelector('[data-a=season-play]:not([disabled])');
  s = await season();
  check(s.log.length === 3 && s.log[2].simmed, 'sim game records a simmed game');
  await page.evaluate(() => {
    // Enough points to buy an upgrade regardless of how the games went.
    const raw = localStorage.getItem('baseball-legacy:slot:0');
    const p = JSON.parse(raw);
    p.skillPoints = (p.skillPoints ?? 0) + 10;
    localStorage.setItem('baseball-legacy:slot:0', JSON.stringify(p));
  });
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  const label = await page.textContent('[data-a=season]');
  check(label?.includes('Continue Season'), `home offers Continue Season after reload (${label})`);
  await page.click('[data-a=season]');
  await page.waitForSelector('.next-card');
  s = await season();
  check(s.day === 3, `season restored from storage (day ${s.day})`);
  await page.click('[data-tab=upgrade]');
  const before = await page.textContent('.up-row:first-child b');
  const pts = Number(await page.textContent('.sp-chip b'));
  await page.click('.up-row:first-child button');
  const after = await page.textContent('.up-row:first-child b');
  const pts2 = Number(await page.textContent('.sp-chip b'));
  check(Number(after) === Number(before) + 1 && pts2 < pts, `upgrade raised a rating ${before}→${after}, points ${pts}→${pts2}`);
  await page.screenshot({ path: `${OUT}/23-season-upgrades.png` });

  // Sim to the playoffs, then to a champion.
  await page.click('[data-a=season-sim-reg]');
  await page.waitForFunction(() => window.__game.season().phase !== 'regular', null, { timeout: 300000 });
  await page.waitForSelector('[data-tab=standings]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  await page.click('[data-tab=standings]');
  await page.screenshot({ path: `${OUT}/24-season-standings.png` });
  await page.click('[data-tab=playoffs]');
  await page.screenshot({ path: `${OUT}/25-season-playoffs.png` });
  await page.click('[data-tab=leaders]');
  await page.screenshot({ path: `${OUT}/26-season-leaders.png` });
  await page.click('[data-tab=you]');
  await page.screenshot({ path: `${OUT}/27-season-you.png` });
  s = await season();
  const games = s.games.filter((g) => g.series === undefined && g.result).length;
  check(games === 80, `regular season complete (${games} of 80 games)`);
  check(s.awards && s.awards.mvp && s.awards.cy, `awards picked (${JSON.stringify(s.awards)})`);

  await page.click('[data-a=season-sim-all]');
  await page.waitForFunction(() => window.__game.season().phase === 'done', null, { timeout: 300000 });
  await page.waitForSelector('.awards');
  await page.screenshot({ path: `${OUT}/28-season-done.png` });
  s = await season();
  check(!!s.champion, `a champion is crowned (${s.champion})`);
  const heading = await page.textContent('.season-panel h1');
  console.log('done screen:', heading);

  await page.click('[data-a=season-new]');
  await page.waitForSelector('[data-a=season-start]');
  check(true, 'new season setup after the title');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
