// Records a narrated walkthrough video of every A2C screen.
//
//   npm run build && npm run demo:video
//
// Env: CHROME_PATH (Chromium binary; extensions need a headed Chromium), OUT_DIR (default output/walkthrough),
//      MOCK=1 (labelled mock matching instead of the real Gemma backend), FFMPEG (path to ffmpeg).
// Real: the built MV3 extension (service worker, storage, scripting, messaging), the website, the internship form.
// Simulated: the side panel runs as a tab (a script cannot open Chrome's native side-panel container), and localhost
// access is pre-granted (native permission dialogs cannot be scripted). Waits for local Gemma are fast-forwarded and
// labelled in the video. All data is fictional and the form is never submitted.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.OUT_DIR ?? join(ROOT, 'output/walkthrough'));
const MOCK = process.env.MOCK === '1';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const CHROME = process.env.CHROME_PATH || undefined;
const DEMO_PORT = 5190;
const SPEED = 8;
const W = 640;
const H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[video]', ...a);
const launchOpts = { ...(CHROME ? { executablePath: CHROME } : {}), headless: false };

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'a2c-video-'));
const procs = [];

async function up(url) {
  return fetch(url).then((r) => r.ok, () => false);
}

// ---- servers ----------------------------------------------------------------------------------------------
procs.push(spawn(process.execPath, [join(ROOT, 'scripts/serve-demo.mjs')], { stdio: 'ignore', env: { ...process.env, DEMO_PORT: String(DEMO_PORT) } }));
if (!MOCK && !(await up('http://127.0.0.1:8787/api/health'))) {
  procs.push(spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'], { cwd: ROOT, stdio: 'ignore' }));
  for (let i = 0; i < 40 && !(await up('http://127.0.0.1:8787/api/health')); i += 1) await sleep(500);
}
await sleep(800);
const BASE = `http://localhost:${DEMO_PORT}`;

// ---- extension copy with localhost pre-granted ---------------------------------------------------------------
const ext = join(work, 'ext');
cpSync(join(ROOT, 'apps/extension/dist'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://localhost/*'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));

async function caption(page, text, fast = false) {
  await page.evaluate(
    ([t, f]) => {
      let el = document.getElementById('__a2c_caption');
      if (!el) {
        el = document.createElement('div');
        el.id = '__a2c_caption';
        el.style.cssText =
          'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#0d0e0d;color:#f2f1ea;padding:11px 14px;font:600 14px/1.35 system-ui;border:2px solid #f2f1ea;box-shadow:4px 4px 0 #000';
        document.body.appendChild(el);
      }
      el.textContent = (f ? 'FAST-FORWARD x8: ' : '') + t;
      el.style.borderColor = f ? '#e9c36c' : '#f2f1ea';
    },
    [text, fast],
  );
  log(text);
}

// ======================================================================================================
// PART 1: website (landing + six workspace pages), 1280x800
// ======================================================================================================
async function websitePart() {
  const browser = await chromium.launch(launchOpts);
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: join(work, 'vid-site'), size: { width: 1280, height: 800 } } });
  const page = await c.newPage();
  await page.goto(`${BASE}/landing.html`);
  await sleep(1200);
  await caption(page, 'Page 1: Landing. A2C fills forms with your permission, and never submits them.');
  await sleep(3500);
  for (const [y, text] of [
    [700, 'How it works: detect, propose, ask permission, fill.'],
    [1500, 'Your context: facts you confirm, reused across forms.'],
    [2300, 'Privacy by design: local by default, permissions per site.'],
    [3300, 'Try the working demo forms, or install the unpacked extension.'],
  ]) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);
    await caption(page, text);
    await sleep(3200);
  }
  const pages = [
    ['dashboard', 'Workspace 1/6: Overview. Your profile and activity at a glance.'],
    ['walkthrough', 'Workspace 2/6: Getting started. Install, add context, try a practice form.'],
    ['profile', 'Workspace 3/6: Your profile. Add, edit, confirm and delete facts.'],
    ['imports', 'Workspace 4/6: Imports and answers. Reviewed text, PDF and ChatGPT paste import.'],
    ['privacy', 'Workspace 5/6: Privacy. Category switches, vault and saved site permissions.'],
    ['settings', 'Workspace 6/6: Settings. Honest storage and connection status.'],
  ];
  for (const [id, text] of pages) {
    await page.goto(`${BASE}/workspace/workspace.html#${id}`);
    await page.reload();
    await sleep(900);
    await caption(page, text);
    await sleep(2000);
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }));
    await sleep(1500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(900);
  }
  const path = await page.video().path();
  await c.close();
  await browser.close();
  return path;
}

// ======================================================================================================
// PART 2: extension on the internship form. Form tab (left) and side panel tab (right), both 640x800.
// ======================================================================================================
async function extensionPart() {
  const ec = await chromium.launchPersistentContext(join(work, 'profile'), {
    ...launchOpts,
    acceptDownloads: true,
    viewport: { width: W, height: H },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    recordVideo: { dir: join(work, 'vid-ext'), size: { width: W, height: H } },
  });
  let [sw] = ec.serviceWorkers();
  if (!sw) sw = await ec.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  // The panel runs as a tab: make its "active tab" the demo form tab.
  await ec.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:') return;
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (q) => (q && q.active ? (await orig({ url: 'http://localhost/*' })).slice(-1) : orig(q));
  });

  const formStart = Date.now();
  const formPage = ec.pages()[0] ?? (await ec.newPage());
  await formPage.goto(`${BASE}/internship-application.html`);
  const panelStart = Date.now();
  const panel = await ec.newPage();
  if (MOCK) {
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.evaluate(() => chrome.storage.local.set({ cf_settings_v1: { aiMode: 'mock' } }));
  }
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sleep(1000);

  const rel = () => (Date.now() - panelStart) / 1000; // t=0 is the panel video start
  const fast = [];
  const cap = (t) => caption(formPage, t);
  const fastWait = async (label, fn) => {
    const a = rel();
    await caption(formPage, label, true);
    await fn();
    fast.push([a, rel()]);
  };
  const clickTab = async (name) => {
    await panel.getByRole('button', { name, exact: true }).click();
    await sleep(900);
  };

  await cap('Extension 1/8: First-run onboarding. One short step: name, email, profile type. All optional.');
  await sleep(2200);
  await panel.getByLabel(/Preferred name/).fill('Alex Example');
  await panel.getByLabel(/^Email/).fill('alex@example.com');
  await panel.getByLabel(/Profile type/).selectOption('Student');
  await sleep(1200);
  await panel.getByRole('button', { name: 'Start using A2C' }).click();
  await sleep(1500);

  await clickTab('Memory');
  await cap('Extension 2/8: Memory. Paste notes; A2C proposes facts and YOU confirm each one before it is saved.');
  const ctxBox = panel.getByLabel('Context to review');
  await ctxBox.scrollIntoViewIfNeeded();
  await ctxBox.fill('College: Example Institute of Technology\nDegree: B.Tech\nMajor: Computer Science\nGraduation year: 2028\nSkills: Python, React, TypeScript\nGitHub: https://github.com/example');
  await sleep(900);
  await panel.getByRole('button', { name: 'Extract candidates' }).click();
  await sleep(1200);
  const boxes = panel.getByRole('checkbox', { name: /I confirm this fact/ });
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) {
    await boxes.nth(i).check();
    await sleep(200);
  }
  await sleep(700);
  await panel.getByRole('button', { name: 'Save confirmed facts' }).click();
  await sleep(1500);

  await clickTab('Settings');
  await cap(MOCK ? 'Extension 3/8: Settings. Mock mode is on and labelled (no AI in this run).' : 'Extension 3/8: Settings. A real connection check: Gemma 4 connected.');
  if (!MOCK) await panel.getByText('Gemma 4 connected').first().waitFor({ timeout: 60000 }).catch(() => undefined);
  await sleep(2600);

  await clickTab('Privacy');
  await cap('Extension 4/8: Privacy. Category switches, saved site permissions, always-manual secrets.');
  await sleep(3000);

  await clickTab('Autofill');
  await cap('Extension 5/8: Autofill. Scan the internship form. The password is blocked before any AI sees it.');
  await sleep(1500);
  await panel.getByRole('button', { name: 'Scan Form' }).click();
  await fastWait('Gemma 4 reads only the unclear field labels (about 45 s on this CPU).', async () => {
    await panel.getByText(/Mapped by|Matched instantly|rule-based fallback|MOCK MODE|Instant rules/).first().waitFor({ timeout: 300000 });
  });
  await cap('Obvious fields were matched by rules; unclear ones by Gemma. The password is BLOCKED.');
  await sleep(3000);

  const remember = panel.getByRole('button', { name: 'Remember for this site' }).first();
  if (await remember.count()) {
    await remember.scrollIntoViewIfNeeded();
    await cap('Email needs approval: Allow once, Remember for this site, or Do not allow.');
    await sleep(2200);
    await remember.click();
    await sleep(1200);
  }
  const phoneRow = panel.locator('li', { hasText: 'Mobile number' });
  if (await phoneRow.getByRole('textbox').count()) {
    await phoneRow.scrollIntoViewIfNeeded();
    await cap('Phone is sensitive and not in memory: type it for THIS form only (Use once).');
    await phoneRow.getByRole('textbox').first().fill('9876543210');
    await phoneRow.getByRole('button', { name: 'Use once' }).click();
    await sleep(1400);
  }
  const cityRow = panel.locator('li', { hasText: 'Which city' });
  if (await cityRow.getByRole('textbox').count()) {
    await cityRow.scrollIntoViewIfNeeded();
    await cap('A new reusable answer: saved for future forms only because you chose to.');
    await cityRow.getByRole('textbox').first().fill('Bengaluru');
    await cityRow.getByRole('button', { name: 'Save to memory' }).click();
    await sleep(1600);
  }
  const draftBtn = panel.getByRole('button', { name: /Draft with Gemma 4|Draft \(mock/ }).first();
  if (await draftBtn.count()) {
    await draftBtn.scrollIntoViewIfNeeded();
    await cap('"Tell us about yourself": a draft built ONLY from facts you tick. You review it before use.');
    await sleep(1800);
    await fastWait('Gemma 4 is writing the draft (about 50 s on this CPU).', async () => {
      await draftBtn.click();
      await panel.getByText(/Gemma 4 draft|MOCK template draft/).first().waitFor({ timeout: 300000 });
    });
    const approve = panel.getByRole('checkbox', { name: /Approve Tell us about yourself/ });
    if (await approve.count()) await approve.check();
    await sleep(1800);
  }
  await cap('Review is done. Fill only the approved fields. A2C will not click Submit.');
  const fill = panel.getByRole('button', { name: /^Fill \d+ approved/ });
  await fill.scrollIntoViewIfNeeded();
  await sleep(1500);
  await fill.click();
  await panel.getByText('Completion summary').waitFor({ timeout: 30000 });
  await formPage.bringToFront();
  await formPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await cap('Filled. The password stays empty and "Submit events counted" stays 0.');
  await sleep(3500);
  await formPage.evaluate(() => window.scrollTo({ top: 1200, behavior: 'smooth' }));
  await sleep(3000);
  log('submit events counted on the page:', await formPage.locator('#submits').textContent());

  await panel.bringToFront();
  await clickTab('Templates');
  await cap('Extension 6/8: Templates. Fill a Word template locally; the file never leaves your browser.');
  await panel.locator('input[type=file]').setInputFiles(join(ROOT, 'demo/example-template.docx'));
  await panel.getByText('example-template.docx').waitFor({ timeout: 30000 });
  await sleep(2800);
  const approvals = panel.getByRole('checkbox', { name: /^Approve/ });
  for (let i = 0; i < (await approvals.count()); i += 1) if (await approvals.nth(i).isEnabled()) await approvals.nth(i).check().catch(() => undefined);
  await sleep(900);
  const dl = panel.getByRole('button', { name: /Download completed copy/ });
  if (await dl.isEnabled().catch(() => false)) {
    const got = panel.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await dl.click();
    await got;
    await cap('A completed copy was downloaded. Password and signature placeholders stay untouched.');
  }
  await sleep(2400);

  await clickTab('Memory');
  await cap('Extension 7/8: Memory again. Each fact shows where it came from; the new city is saved.');
  await sleep(3500);
  await clickTab('Privacy');
  await cap('Extension 8/8: Privacy. The saved site permission is listed and can be revoked at any time.');
  await panel.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
  await sleep(3500);
  await cap('Done. This ran in the real MV3 extension; waiting for Gemma was fast-forwarded.');
  await sleep(2500);

  const formVideo = formPage.video();
  const panelVideo = panel.video();
  await ec.close();
  return { form: await formVideo.path(), panel: await panelVideo.path(), formLead: (panelStart - formStart) / 1000, fast };
}

// ---- assemble ----------------------------------------------------------------------------------------------
function ff(args) {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
}
function segmentFilter(input, fast, label) {
  const cuts = [];
  let cur = 0;
  for (const [a, b] of fast) {
    if (a > cur) cuts.push([cur, a, 1]);
    cuts.push([a, b, SPEED]);
    cur = b;
  }
  cuts.push([cur, 99999, 1]);
  const parts = cuts.map(([a, b, s], i) => `[${input}]trim=start=${a}:end=${b},setpts=(PTS-STARTPTS)/${s}[${label}${i}]`);
  return `${parts.join(';')};${cuts.map((_, i) => `[${label}${i}]`).join('')}concat=n=${cuts.length}:v=1:a=0,fps=25[${label}]`;
}

try {
  const sitePath = await websitePart();
  const e = await extensionPart();
  log('assembling video');
  ff(['-i', sitePath, '-vf', 'scale=1280:800,fps=25,format=yuv420p', join(work, 'site.mp4')]);
  // Align: the form video started `formLead` seconds before the panel video; trim that lead off the form video.
  const filter = [
    `[0:v]trim=start=${e.formLead},setpts=PTS-STARTPTS[fa]`,
    segmentFilter('fa', e.fast, 'f'),
    segmentFilter('1:v', e.fast, 'p'),
    `[f][p]hstack=inputs=2:shortest=1,scale=1280:800,format=yuv420p[o]`,
  ].join(';');
  ff(['-i', e.form, '-i', e.panel, '-filter_complex', filter, '-map', '[o]', join(work, 'ext.mp4')]);
  const list = join(work, 'list.txt');
  writeFileSync(list, `file '${join(work, 'site.mp4').replace(/\\/g, '/')}'\nfile '${join(work, 'ext.mp4').replace(/\\/g, '/')}'\n`);
  const finalFile = join(OUT, 'a2c-walkthrough.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-movflags', '+faststart', finalFile]);
  writeFileSync(
    join(OUT, 'README.txt'),
    `a2c-walkthrough.mp4\nmode: ${MOCK ? 'MOCK matching (labelled)' : 'real Gemma 4 through the A2C backend'}\nfast-forwarded waits (x${SPEED}): ${e.fast.length}\nside panel shown as a tab, not Chrome's native side-panel container\nlocalhost access pre-granted (native permission dialogs cannot be scripted)\nall data fictional; the form was never submitted\n`,
  );
  log('done:', finalFile);
} finally {
  for (const p of procs) p.kill();
  rmSync(work, { recursive: true, force: true });
}
process.exit(0);
