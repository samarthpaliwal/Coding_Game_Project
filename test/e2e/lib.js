// Shared e2e helpers: boot the server, open phone-sized browser contexts, drive the UI.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ART = path.join(__dirname, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

export async function bootServer(env = {}) {
  const port = 4100 + Math.floor(Math.random() * 500);
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  proc.stdout.on('data', (d) => logs.push(String(d)));
  proc.stderr.on('data', (d) => logs.push('ERR ' + String(d)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + '/healthz');
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  return { base, proc, logs, stop: () => proc.kill('SIGTERM') };
}

export async function launch() {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  return browser;
}

export async function phone(browser, name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  page.__name = name;
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.__errors.push(`${name} console: ${m.text()}`);
  });
  return page;
}

export async function tvPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.__name = 'tv';
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(`tv: ${e.message}`));
  return page;
}

export async function createRoom(page, base, name) {
  await page.goto(base + '/');
  await page.fill('#name', name);
  await page.click('button:has-text("Create a new room")');
  await page.waitForSelector('.lobby', { timeout: 8000 });
  const code = (await page.textContent('.code-pill .code')).trim();
  return code;
}

export async function joinRoom(page, base, code, name) {
  await page.goto(`${base}/r/${code}`);
  await page.fill('#name', name);
  await page.click('button:has-text("Join")');
  await page.waitForSelector('.lobby', { timeout: 8000 });
}

export async function shot(page, label) {
  const file = path.join(ART, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}
