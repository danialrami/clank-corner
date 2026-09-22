import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium as playwrightChromium } from 'playwright';
import { createServer } from '../dist/src/server.js';
import { verifyReplay } from '../dist/src/engine.js';

async function executable() {
  if (process.env.CHROMIUM_PATH) return { path: process.env.CHROMIUM_PATH, args: [] };
  const module = await import('@sparticuz/chromium');
  const sparticuz = module.default;
  const path = await sparticuz.executablePath();
  if (!path) throw new Error('No Chromium executable found. Set CHROMIUM_PATH or install @sparticuz/chromium.');
  return { path, args: sparticuz.args };
}

const app = createServer();
let browser;
const downloads = await mkdtemp(join(tmpdir(), 'clank-browser-'));
const browserProblems = [];

try {
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const browserConfig = await executable();
  browser = await playwrightChromium.launch({ executablePath: browserConfig.path, args: browserConfig.args, headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserProblems.push(`console: ${message.text()}`);
  });

  // Simulate the secure-context API unavailable on ordinary HTTP LAN pages.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#fighter-name').fill('<img id="injected" src=x>');
  await page.locator('#coach-note').fill('Keep distance; this is delivered only to my external observation.');
  await page.locator('#opponent-style').selectOption('cautious');
  await page.locator('#create-bout').click();
  await page.locator('#arena:not([hidden])').waitFor();
  await page.waitForFunction(() => document.querySelector('#name-a')?.textContent === '<img id="injected" src=x>');
  assert.equal(await page.locator('#name-a').textContent(), '<img id="injected" src=x>');
  assert.equal(await page.locator('#injected').count(), 0, 'fighter name must remain inert text');
  assert.equal(await page.locator('[data-action="guard"]').isVisible(), true, 'mobile move control is visible');

  for (let turn = 1; turn <= 8; turn += 1) {
    const before = await page.locator('#turn-label').textContent();
    await page.locator('[data-action="guard"]').click();
    await page.waitForFunction((previous) => document.querySelector('#turn-label')?.textContent !== previous, before);
  }
  assert.equal(await page.locator('#match-state').textContent(), 'Complete');
  assert.match(await page.locator('#pending-label').textContent() ?? '', /Draw|wins/);
  await page.locator('#terminal-tools:not([hidden])').waitFor();

  await page.locator('#inspect-replay').click();
  await page.locator('#replay-panel:not([hidden])').waitFor();
  assert.equal(await page.locator('#replay-step').textContent(), 'Start · 0 / 8');
  await page.locator('#replay-next').click();
  assert.equal(await page.locator('#replay-step').textContent(), 'Turn 1 / 8');
  assert.match(await page.locator('#replay-event').textContent() ?? '', /guard vs cautious|guard vs guard|guard vs/);
  await page.locator('#replay-range').fill('8');
  assert.equal(await page.locator('#replay-step').textContent(), 'Turn 8 / 8');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-replay').click();
  const download = await downloadPromise;
  const replayPath = join(downloads, await download.suggestedFilename());
  await download.saveAs(replayPath);
  const replay = JSON.parse(await readFile(replayPath, 'utf8'));
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
  assert.equal(JSON.stringify(replay).includes('Keep distance'), false, 'private note must not enter replay');

  await page.locator('#fighter-name').fill('Rematch Hero');
  await page.locator('#coach-note').fill('Watch counters on the rematch.');
  await page.locator('#opponent-style').selectOption('reactive');
  const rematchResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/rematch'));
  await page.locator('#rematch').click();
  const rematchResponse = await rematchResponsePromise;
  assert.equal(rematchResponse.status(), 201);
  const rematchBody = await rematchResponse.json();
  const rematch = rematchBody.data;
  await page.waitForFunction(() => document.querySelector('#name-a')?.textContent === 'Rematch Hero');
  assert.equal(await page.locator('#match-state').textContent(), 'Active');
  const observationResponse = await fetch(`${base}/api/matches/${rematch.id}/observe`, {
    headers: { authorization: `Bearer ${rematch.tokens.A}` },
  });
  assert.equal(observationResponse.status, 200);
  const observation = await observationResponse.json();
  assert.equal(observation.data.coachNote, 'Watch counters on the rematch.');
  assert.equal(observation.data.observation.opponent.style, 'reactive');
  assert.equal(observation.data.observation.self.role, 'external');
  const watcher = await context.newPage();
  watcher.on('pageerror', (error) => browserProblems.push(`spectator: ${error.message}`));
  await watcher.goto(base, { waitUntil: 'networkidle' });
  await watcher.locator('#watch-id').fill(rematch.id);
  await watcher.locator('#watch-bout').click();
  await watcher.waitForFunction(() => document.querySelector('#name-a')?.textContent === 'Rematch Hero');
  assert.equal(await watcher.locator('[data-action="guard"]').isDisabled(), true);
  for (let turn = 1; turn <= 8; turn += 1) {
    const submitted = await fetch(`${base}/api/matches/${rematch.id}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${rematch.tokens.A}` },
      body: JSON.stringify({ leg: 1, turn, action: { type: 'guard' }, requestId: `watch-${turn}` }),
    });
    assert.equal(submitted.status, 200);
  }
  await watcher.waitForFunction(() => document.querySelector('#match-state')?.textContent === 'Complete');
  await watcher.locator('#inspect-replay').click();
  await watcher.locator('#replay-panel:not([hidden])').waitFor();
  assert.equal(await watcher.locator('#rematch').isVisible(), false, 'spectator cannot control host rematch');
  assert.deepEqual(browserProblems, []);

  await context.close();
  process.stdout.write('Browser E2E passed: practice completion, replay stepping/export, inert text, style/note rematch, mobile controls.\n');
} finally {
  if (browser) await browser.close();
  await app.close();
  await rm(downloads, { recursive: true, force: true });
}
