// Records the extension the way a person uses it: a real browser window, the real toolbar icon, the real side panel.
//
//   npm run build && npm run demo:native
//
// Env: CHROME_PATH (Playwright Chromium or Chrome for Testing; branded Chrome refuses --load-extension),
//      OUT_DIR (default output/walkthrough), FFMPEG, LOGICAL_W / LOGICAL_H (screen size in logical pixels).
// It takes over the real mouse and screen for a few minutes: do not touch the computer while it runs.
// The mouse moves and clicks the toolbar icon and key buttons. Typing and some checkboxes go through the browser
// debugging protocol. Waits for the AI are shown in real time. All data is fictional; the form is never submitted.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.OUT_DIR ?? join(ROOT, 'output/walkthrough'));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const CHROME = process.env.CHROME_PATH;
if (!CHROME) throw new Error('Set CHROME_PATH to a Chromium or Chrome for Testing binary (branded Chrome cannot sideload extensions).');
const LW = Number(process.env.LOGICAL_W ?? 1440);
const LH = Number(process.env.LOGICAL_H ?? 900);
const WIN_H = LH - 40; // leave the taskbar out of the recording
const DEMO_PORT = 5174; // the extension only trusts the workspace at http://127.0.0.1:5174
const CDP_PORT = 9333;
const PS = join(ROOT, 'scripts/native-input.ps1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[native]', ...a);

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'a2c-native-'));
const procs = [];
let ffmpegProc;

const input = (cmd, x = 0, y = 0, ms = 600) => {
  const r = spawnSync('powershell', ['-NoProfile', '-File', PS, cmd, String(x), String(y), String(ms)], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`input ${cmd} failed`);
};
const up = (url) => fetch(url).then((r) => r.ok, () => false);

// ---- servers ----------------------------------------------------------------------------------------------
procs.push(spawn(process.execPath, [join(ROOT, 'scripts/serve-demo.mjs')], { stdio: 'ignore', env: { ...process.env, DEMO_PORT: String(DEMO_PORT) } }));
if (!(await up('http://127.0.0.1:8787/api/health'))) {
  procs.push(spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'], { cwd: ROOT, stdio: 'ignore' }));
  for (let i = 0; i < 40 && !(await up('http://127.0.0.1:8787/api/health')); i += 1) await sleep(500);
}
await sleep(800);
const BASE = `http://127.0.0.1:${DEMO_PORT}`;

// ---- extension copy (localhost pre-granted) and a profile with the icon pinned to the toolbar -------------------
const ext = join(work, 'ext');
const profile = join(work, 'profile');
cpSync(join(ROOT, 'apps/extension/dist'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));

const setup = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  ignoreDefaultArgs: ['--enable-automation'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw0] = setup.serviceWorkers();
if (!sw0) sw0 = await setup.waitForEvent('serviceworker');
const extId = new URL(sw0.url()).host;
await setup.close();
const prefsPath = join(profile, 'Default/Preferences');
const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
prefs.extensions = { ...(prefs.extensions ?? {}), pinned_extensions: [extId] };
writeFileSync(prefsPath, JSON.stringify(prefs));
log('extension', extId);

// ---- real browser window --------------------------------------------------------------------------------------
input('minimize');
await sleep(800);
const browserArgs = [
  `--user-data-dir=${profile}`,
  `--disable-extensions-except=${ext}`, // keeps unrelated extensions Windows registered for browsers out of the recording
  `--load-extension=${ext}`,
  `--remote-debugging-port=${CDP_PORT}`,
  '--window-position=0,0',
  `--window-size=${LW},${WIN_H}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--test-type',
  `${BASE}/landing.html`,
];
if (await up(`http://localhost:${CDP_PORT}/json/version`)) throw new Error(`Port ${CDP_PORT} is already in use: close the other test browser first.`);
const quoted = browserArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
spawnSync('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath '${CHROME}' -ArgumentList ${quoted}`], { stdio: 'ignore' });
for (let i = 0; i < 40 && !(await up(`http://localhost:${CDP_PORT}/json/version`)); i += 1) await sleep(500);
const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const ctx = browser.contexts()[0];
let formPage;
for (let i = 0; i < 40 && !formPage; i += 1) {
  formPage = ctx.pages().find((p) => p.url().includes('landing.html'));
  if (!formPage) await sleep(250);
}
await formPage.bringToFront();
await sleep(2000);

// ---- screen recording (browser window only; the taskbar and clock stay out) -------------------------------------
const outRaw = join(work, 'raw.mkv');
ffmpegProc = spawn(
  FFMPEG,
  ['-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '25', '-draw_mouse', '1', '-offset_x', '0', '-offset_y', '0', '-video_size', `${LW * 2}x${(WIN_H - 14) * 2}`, '-i', 'desktop', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', outRaw],
  { stdio: ['pipe', 'ignore', 'inherit'] },
);
await sleep(1500);

// ---- helpers ------------------------------------------------------------------------------------------------
async function caption(text, target = formPage) {
  await target.evaluate((t) => {
    let el = document.getElementById('__a2c_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__a2c_caption';
      el.style.cssText = 'position:fixed;left:14px;right:14px;bottom:14px;z-index:2147483647;background:#111;color:#fff;font:600 17px/1.35 system-ui,sans-serif;padding:12px 16px;border:2px solid #fff;pointer-events:none';
      document.documentElement.appendChild(el);
    }
    el.textContent = t;
  }, text);
  log(text);
}

const ICON = [Math.round(LW - 155), 62]; // the pinned A2C icon (position is stable for this window size)
let panel;
let panelLeft = 0;
const extraBrowsers = [];
const PANEL_TOP = 126; // logical y where the side panel content starts
const isPanel = (p) => p.url().startsWith(`chrome-extension://${extId}/sidepanel.html`);
async function locatePanel() {
  // The side panel is not always listed on the first connection; a fresh connection sees every existing target.
  for (let i = 0; i < 24 && !panel; i += 1) {
    panel = ctx.pages().find(isPanel);
    if (!panel) {
      const again = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`).catch(() => null);
      panel = again?.contexts().flatMap((c) => c.pages()).find(isPanel);
      if (panel) extraBrowsers.push(again);
      else await again?.close().catch(() => undefined);
    }
    if (!panel) await sleep(500);
  }
  if (!panel) {
    spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '1', '-i', 'desktop', '-frames:v', '1', join(OUT, 'debug-no-panel.png')]);
    throw new Error('side panel did not open (see debug-no-panel.png)');
  }
  const width = await panel.evaluate(() => window.innerWidth);
  panelLeft = LW - 15 - width; // the panel sits against the right edge, beside the page scrollbar
}

/** Click with the real mouse at an element's position; fall back to the debugging protocol if nothing changed. */
async function realClick(locator, changed) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box for click target');
  input('click', Math.round(panelLeft + box.x + box.width / 2), Math.round(PANEL_TOP + box.y + box.height / 2), 700);
  await sleep(900);
  if (changed && !(await changed().catch(() => false))) {
    log('real click did not register; using protocol click');
    await locator.click();
    await sleep(600);
  }
}
const tabButton = (name) => panel.getByRole('button', { name, exact: true });
const openTab = async (name) => {
  const b = tabButton(name);
  await realClick(b, async () => (await b.getAttribute('aria-current')) === 'page');
};

/** The side panel stays open across tabs in most cases; reopen it from the toolbar if it was closed. */
async function ensurePanel() {
  if (panel && !panel.isClosed()) return;
  panel = undefined;
  await formPage.bringToFront();
  input('click', ICON[0], ICON[1], 900);
  await sleep(2000);
  await locatePanel();
}

async function smoothScroll(page, to, ms) {
  await page.evaluate(
    ([target, dur]) =>
      new Promise((resolve) => {
        const from = window.scrollY;
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / dur);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          window.scrollTo(0, from + (target - from) * e);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [to, ms],
  );
}
const FORM_URL = `${BASE}/internship-application.html`;

// ---- scenes ---------------------------------------------------------------------------------------------------
// ===== Part 1: the website. Landing page with its scroll tour, then the workspace pages. =====
await caption('Page 1: The A2C website. It fills forms with your permission and never submits them.');
await sleep(3500);
const tour = await formPage.evaluate(() => {
  const l = document.querySelector('[data-launch]');
  return { top: l.offsetTop, span: l.offsetHeight - window.innerHeight };
});
for (const [p, text, ms] of [
  [0.12, 'Product tour: scrolling zooms into a form you have filled a hundred times.', 4200],
  [0.5, 'A2C reads labels, never values, and fills only facts you confirmed.', 5200],
  [0.72, 'Sensitive fields wait for approval. Passwords never fill.', 3800],
  [0.98, 'Zoom out: a website, an extension and one profile.', 4200],
]) {
  await smoothScroll(formPage, tour.top + tour.span * p, ms);
  await caption(text);
  await sleep(1800);
}
for (const [sel, text] of [
  ['#how', 'How it works: detect, propose, ask permission, fill. You press Submit.'],
  ['#app', 'The workspace shows your profile and real usage numbers (these are sample data).'],
  ['#privacy', 'Privacy by design: local by default, permissions per site.'],
  ['#demo', 'Working demo forms to try, and the developer install steps.'],
]) {
  await formPage.evaluate((q) => document.querySelector(q).scrollIntoView({ behavior: 'smooth' }), sel);
  await caption(text);
  await sleep(3400);
}
await smoothScroll(formPage, 0, 1500);
await caption('Open the workspace from the website.');
await sleep(1500);
await formPage.getByRole('link', { name: /Open workspace/ }).first().click();
await formPage.waitForURL(/workspace\.html/);
await sleep(1200);
for (const [name, text] of [
  ['Account', 'Page 2: Account. Create your account here; the extension connects to it.'],
  ['Overview', 'Page 3: Overview. Real usage numbers appear once the extension is connected.'],
  ['Getting started', 'Page 4: Getting started. Install, add context, try a practice form.'],
  ['Your profile', 'Page 5: Your profile. Add, edit, confirm and delete facts.'],
  ['Imports & answers', 'Page 6: Imports and answers. Reviewed text, PDF and ChatGPT paste import.'],
  ['Privacy', 'Page 7: Privacy. Category switches, vault and saved site permissions.'],
  ['Settings', 'Page 8: Settings. Honest storage and connection status.'],
]) {
  await formPage.getByRole('navigation', { name: 'Workspace pages' }).getByRole('link', { name, exact: true }).click();
  await sleep(700);
  await caption(text);
  await sleep(2400);
  await smoothScroll(formPage, 700, 1400);
  await sleep(900);
  await smoothScroll(formPage, 0, 1000);
  await sleep(500);
}

// ===== Part 2: a real form and the extension, opened from the browser toolbar. =====
await formPage.goto(FORM_URL);
await sleep(1200);
await caption('A normal website with a form. Open A2C from the browser toolbar.');
await sleep(2800);
input('move', Math.round(LW / 2), 300, 900);
await sleep(500);
input('click', Math.round(LW / 2), 150, 600); // focus the window first: the first click on an inactive window only activates it
await sleep(400);
const panelOpen = async () => (await fetch(`http://localhost:${CDP_PORT}/json`).then((r) => r.text(), () => '')).includes(`${extId}/sidepanel.html`);
for (let attempt = 0; attempt < 3 && !(await panelOpen()); attempt += 1) {
  input('click', ICON[0], ICON[1], 1100);
  await sleep(2500);
}
await locatePanel();
await sleep(1200);
await caption('The side panel opens beside the page and offers your website account.');
await sleep(2600);
const connectBtn = panel.getByRole('button', { name: /Create or connect website account/ });
const sitePage = ctx.waitForEvent('page', { timeout: 30000 });
await realClick(connectBtn);
const site = await sitePage;
await site.waitForLoadState('domcontentloaded');
await site.bringToFront();
await site.getByLabel('Your name').waitFor({ timeout: 20000 });
await caption('The website opens on its account page. Create your account once.', site);
await sleep(2200);
await site.getByLabel('Your name').fill('Ravi Kumar');
await sleep(500);
await site.getByLabel('Email').fill('ravi@example.com');
await sleep(500);
await site.getByLabel(/Profile type/).selectOption('Student');
await sleep(1000);
await site.getByRole('button', { name: 'Create account' }).click();
await site.getByText(/Sent to your extension|Open this page|Open this workspace|did not accept/).first().waitFor({ timeout: 20000 });
await caption('The account is sent to the extension. It is only a suggestion until you confirm it there.', site);
await sleep(3200);
await formPage.bringToFront();
await sleep(1200);
await ensurePanel();
await caption('Back on the form: the panel shows the account to confirm.', formPage);
await panel.getByRole('button', { name: 'Confirm and continue' }).waitFor({ timeout: 20000 });
await sleep(2600);
await realClick(panel.getByRole('button', { name: 'Confirm and continue' }), async () => !(await panel.getByRole('button', { name: 'Confirm and continue' }).isVisible()));
await sleep(1200);

await caption('Home: your usage, a profile checklist and a privacy summary. Counts stay in this browser.');
await sleep(3200);

await openTab('Memory');
await caption('Memory: paste notes. A2C proposes facts and YOU confirm each one before it is saved.');
const ctxBox = panel.getByLabel('Context to review');
await ctxBox.scrollIntoViewIfNeeded();
await ctxBox.fill('Name: Ravi Kumar\nCollege: Example Institute of Technology\nDegree: B.Tech\nMajor: Computer Science\nGraduation year: 2028\nSkills: Python, React, TypeScript\nGitHub: https://github.com/example');
await sleep(900);
await realClick(panel.getByRole('button', { name: 'Extract candidates' }), async () => (await panel.getByRole('checkbox', { name: /I confirm this fact/ }).count()) > 0);
await sleep(1000);
const boxes = panel.getByRole('checkbox', { name: /I confirm this fact/ });
for (let i = 0; i < (await boxes.count()); i += 1) {
  await boxes.nth(i).check();
  await sleep(200);
}
await sleep(600);
await realClick(panel.getByRole('button', { name: 'Save confirmed facts' }));
await sleep(1500);

await openTab('Settings');
await caption('Settings: a real connection check. Auto engine: fine-tuned specialist first, Gemma 4 as fallback.');
await panel.getByText(/Auto: |Gemma 4 connected/).first().waitFor({ timeout: 60000 }).catch(() => undefined);
await sleep(2800);

await openTab('Privacy');
await caption('Privacy: category switches, saved site permissions, always-manual secrets.');
await sleep(3000);

await openTab('Autofill');
await caption('Autofill: scan the form. The password is blocked before any AI sees it.');
await sleep(1500);
await realClick(panel.getByRole('button', { name: 'Scan Form' }));
await panel.getByText(/Mapped by|Matched instantly|rule-based fallback|MOCK MODE|Instant rules/).first().waitFor({ timeout: 300000 });
await caption('Obvious fields matched by rules; unclear ones by the specialist or Gemma 4. The password is BLOCKED.');
await sleep(3200);

const remember = panel.getByRole('button', { name: 'Remember for this site' }).first();
if (await remember.count()) {
  await remember.scrollIntoViewIfNeeded();
  await caption('Email needs approval: Allow once, Remember for this site, or Do not allow.');
  await sleep(2200);
  await realClick(remember);
  await sleep(1000);
}
const phoneRow = panel.locator('li', { hasText: 'Mobile number' });
if (await phoneRow.getByRole('textbox').count()) {
  await phoneRow.scrollIntoViewIfNeeded();
  await caption('Phone is sensitive and not in memory: type it for THIS form only (Use once).');
  await phoneRow.getByRole('textbox').first().fill('9876543210');
  await realClick(phoneRow.getByRole('button', { name: 'Use once' }));
  await sleep(1200);
}
const cityRow = panel.locator('li', { hasText: 'Which city' });
if (await cityRow.getByRole('textbox').count()) {
  await cityRow.scrollIntoViewIfNeeded();
  await caption('A new reusable answer: saved for future forms only because you chose to.');
  await cityRow.getByRole('textbox').first().fill('Bengaluru');
  await realClick(cityRow.getByRole('button', { name: 'Save to memory' }));
  await sleep(1400);
}
const draftBtn = panel.getByRole('button', { name: /Draft with Gemma 4|Draft \(mock/ }).first();
if (await draftBtn.count()) {
  await draftBtn.scrollIntoViewIfNeeded();
  await caption('"Tell us about yourself": a draft built ONLY from facts you tick. You review it before use.');
  await sleep(1800);
  await realClick(draftBtn);
  await panel.getByText(/Gemma 4 draft|MOCK template draft/).first().waitFor({ timeout: 300000 });
  const approve = panel.getByRole('checkbox', { name: /Approve Tell us about yourself/ });
  if (await approve.count()) await approve.check();
  await sleep(1800);
}
await caption('Review is done. Fill only the approved fields. A2C will not click Submit.');
const fill = panel.getByRole('button', { name: /^Fill \d+ approved/ });
await fill.scrollIntoViewIfNeeded();
await sleep(1500);
await realClick(fill, async () => panel.getByText('Completion summary').isVisible());
await panel.getByText('Completion summary').waitFor({ timeout: 30000 });
await sleep(1500);
await caption('Filled. The password stays empty and "Submit events counted" stays 0.');
await formPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await sleep(3200);
await formPage.evaluate(() => window.scrollTo({ top: 1200, behavior: 'smooth' }));
await sleep(3000);
log('submit events counted on the page:', await formPage.locator('#submits').textContent());

await openTab('Templates');
await caption('Templates: fill a Word template locally. The file never leaves your browser.');
await panel.locator('input[type=file]').setInputFiles(join(ROOT, 'demo/example-template.docx'));
await panel.getByText('example-template.docx').waitFor({ timeout: 30000 });
await sleep(2800);

await openTab('Memory');
await caption('Memory again: each fact shows where it came from; the new city is saved.');
await sleep(3500);
await openTab('Privacy');
await caption('Privacy: the saved site permission is listed and can be revoked at any time.');
await sleep(3500);
await site.bringToFront();
await site.goto(`${BASE}/workspace/workspace.html#dashboard`);
await sleep(1500);
await caption('Back in the workspace: the account you created greets you on the Overview.', site);
await sleep(3500);
await site.goto(`${BASE}/workspace/workspace.html#profile`);
await sleep(1200);
await caption('Your profile now holds the confirmed facts from the account, plus the ones imported from notes.', site);
await sleep(3500);
await formPage.bringToFront();
await caption('Done. Website, account, extension and fill: all in the real browser.');
await sleep(2500);

// ---- finish ----------------------------------------------------------------------------------------------------
ffmpegProc.stdin.write('q');
await new Promise((r) => ffmpegProc.once('exit', r));
const final = join(OUT, 'a2c-native.mp4');
const enc = spawnSync(
  FFMPEG,
  ['-y', '-loglevel', 'error', '-i', outRaw, '-vf', 'scale=1920:-2,format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-crf', '22', '-preset', 'medium', '-movflags', '+faststart', '-an', final],
  { stdio: 'inherit' },
);
if (enc.status !== 0) throw new Error('ffmpeg encode failed');
log('done:', final);

try {
  await browser.close().catch(() => undefined);
  for (const p of procs) p.kill();
  input('restore');
  rmSync(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
} catch {
  log('temp folder not removed:', work);
}
process.exit(0);
