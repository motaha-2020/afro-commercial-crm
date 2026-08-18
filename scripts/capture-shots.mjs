/**
 * Screenshots for the client walkthrough, taken on the server against the
 * running deployment.
 *
 *   node scripts/capture-shots.mjs            # writes into /tmp/acms-shots
 *
 * It authenticates the way the smoke suite does — a POST to the web app's own
 * login route — and hands the resulting session cookie to the browser. Nothing
 * is typed into the form: the cookie is the credential the screens actually
 * use, and driving the form would only be a slower way to obtain it.
 *
 * Shots are numbered in presentation order (docs/client-walkthrough.md §6), so
 * the file names sort into the order they will be shown in.
 */
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB ?? 'http://100.122.6.64:3100';
const OUT = process.env.OUT ?? '/tmp/acms-shots';
const LOCALE = process.env.LOCALE ?? 'en';
const EMAIL = process.env.EMAIL ?? 'ceo@afro.example';
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe#2026';

const OPP = process.env.OPP;
const ARM = process.env.ARM;
const HOLDING = process.env.HOLDING;
const VER = process.env.VER;
if (!OPP || !ARM || !HOLDING) throw new Error('OPP, ARM and HOLDING must be set');

async function sessionCookie() {
  const res = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const access = raw.map((c) => c.split(';')[0]).find((c) => c.startsWith('acms_access='));
  if (!access) throw new Error('no session cookie in the login response');
  const [name, ...rest] = access.split('=');
  return { name, value: rest.join('='), domain: new URL(WEB).hostname, path: '/' };
}

const shots = [
  { n: '01', name: 'dashboard', url: '/dashboard', full: true },
  { n: '02', name: 'pipeline', url: '/opportunities', full: true },
  { n: '03', name: 'opportunity', url: `/opportunities/${OPP}` },
  { n: '04', name: 'opportunity-team', url: `/opportunities/${OPP}`, find: 'team' },
  { n: '05', name: 'account-360', url: `/accounts/${ARM}`, full: true },
  { n: '06', name: 'account-relationship-inverse', url: `/accounts/${HOLDING}`, find: 'relationship' },
  { n: '07', name: 'bid-workspace', url: `/opportunities/${OPP}/bids`, full: true },
  { n: '08', name: 'scope', url: `/opportunities/${OPP}/scope`, full: true },
  { n: '09', name: 'supplier-comparison', url: `/opportunities/${OPP}/quotations`, full: true },
  { n: '10', name: 'costing', url: `/opportunities/${OPP}/costing`, full: true },
  ...(VER ? [{ n: '11', name: 'costing-version', url: `/opportunities/${OPP}/costing?version=${VER}`, full: true }] : []),
  { n: '12', name: 'approvals', url: '/approvals', full: true },
  { n: '13', name: 'proposals', url: `/opportunities/${OPP}/proposals`, full: true },
  { n: '14', name: 'contract-deviations', url: `/opportunities/${OPP}/contract`, full: true },
  { n: '15', name: 'clause-register', url: `/opportunities/${OPP}/contract`, find: 'clause' },
  { n: '16', name: 'import', url: '/import/accounts', full: true },
  { n: '17', name: 'ref-lists', url: '/ref-lists', full: true },
  { n: '18', name: 'settings-approval-limits', url: '/settings', full: true },
  { n: '19', name: 'users-and-roles', url: '/users', full: true },
];

const cookie = await sessionCookie();
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
await page.setCookie(cookie);

for (const shot of shots) {
  const url = `${WEB}/${LOCALE}${shot.url}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
  // The panels stream in after the first paint; a fixed pause beats a selector
  // per screen, and these are screenshots rather than assertions.
  await new Promise((r) => setTimeout(r, 1200));

  if (shot.find) {
    // Scroll the named panel to the top of the frame so the shot is of that
    // panel rather than of whatever happens to be at the top of a long page.
    await page.evaluate((needle) => {
      const el = [...document.querySelectorAll('h1,h2,h3')].find((h) =>
        h.textContent.toLowerCase().includes(needle),
      );
      if (el) el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -20);
    }, shot.find);
    await new Promise((r) => setTimeout(r, 400));
  }

  const file = `${OUT}/${shot.n}-${shot.name}.png`;
  if (shot.full) {
    // NOT fullPage: the sidebar is position:fixed, and a full-page capture
    // paints it once at the top and then lets the content scroll underneath —
    // every shot came out with the first 360px of the page behind the nav.
    // Growing the viewport to the document instead means one real paint, with
    // the sidebar where a person would see it.
    const height = await page.evaluate(() =>
      Math.min(Math.max(document.body.scrollHeight, window.innerHeight), 4000),
    );
    await page.setViewport({ width: 1440, height, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 600));
  }
  await page.screenshot({ path: file });
  if (shot.full) {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  }
  console.log(`  ${shot.n} ${shot.name}`);
}

// The three languages, same screen, for the closing slide.
for (const loc of ['ar', 'en', 'fr']) {
  await page.goto(`${WEB}/${loc}/opportunities/${OPP}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/20-language-${loc}.png` });
  console.log(`  20 language-${loc}`);
}

await browser.close();
console.log(`\nwritten to ${OUT}`);
