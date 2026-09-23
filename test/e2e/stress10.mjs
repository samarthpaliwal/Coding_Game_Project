// Ten phones at 360px through one round: no horizontal scroll anywhere, refresh lands on the same screen.
import { bootServer, launch, createRoom, joinRoom, shot, sleep, assert } from './lib.js';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const srv = await bootServer({ CONTRABAND_FAST: '1' });
const browser = await launch();
const NAMES = ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fox', 'Gus', 'Hal', 'Ivy', 'Jo'];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function smallPhone(name) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.__name = name;
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(`${name}: ${e.message}`));
  return page;
}
async function noHScroll(page, label) {
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: innerWidth }));
  assert(w.doc <= w.vw + 1 && w.body <= w.vw + 1, `${label}: horizontal overflow ${JSON.stringify(w)}`);
  const small = await page.$$eval('button:not(.kick):not(.react):not(.tiny):not(.small):not(.avatar):not(.lineup-head)', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.className + ':' + e.textContent.trim().slice(0, 20)));
  if (small.length) console.log(`  note ${label}: short controls`, small.slice(0, 5));
}
async function refreshAndCheck(page, selector, label) {
  await page.reload();
  await page.waitForSelector(selector, { timeout: 10000 });
  log(`refresh in ${label}: ok`);
}

try {
  const phones = [];
  const host = await smallPhone('Ana');
  const code = await createRoom(host, srv.base, 'Ana');
  phones.push(host);
  for (const n of NAMES.slice(1)) {
    const p = await smallPhone(n);
    await joinRoom(p, srv.base, code, n);
    phones.push(p);
  }
  await host.waitForFunction(() => document.querySelectorAll('.player-list .player').length === 10);
  await noHScroll(host, 'lobby');
  await shot(host, 's01-lobby-10');
  await host.click('button:has-text("Start Contraband")');
  await Promise.all(phones.map((p) => p.waitForSelector('.role-card', { timeout: 15000 })));
  const roles = await Promise.all(phones.map((p) => p.evaluate(() => ({ smug: !!document.querySelector('.role-card.smuggler'), word: document.querySelector('.role-word')?.textContent || null }))));
  const smugglers = roles.filter((r) => r.smug).length;
  log('smugglers in round 1 with 10 players:', smugglers);
  assert(smugglers === 3, 'k0 for 10 players is 3');
  await noHScroll(phones[1], 'briefing');
  await Promise.all(phones.map((p) => p.waitForSelector('#answer', { timeout: 15000 })));
  await noHScroll(phones[1], 'write');
  await refreshAndCheck(phones[2], '#answer', 'write');
  for (let i = 0; i < phones.length; i++) {
    const w = roles[i].word;
    await phones[i].fill('#answer', w ? `A ${w} on the moon, said ${NAMES[i]}` : `${NAMES[i]} would like a word with the manager`);
    if (i < 9) {
      await phones[i].click('button:has-text("Submit")');
      await phones[i].waitForSelector('.submitted-answer, .answer-card', { timeout: 5000 });
    }
  }
  await noHScroll(phones[0], 'write-submitted');
  await shot(phones[0], 's02-write-submitted-10');
  await phones[9].click('button:has-text("Submit")');
  await Promise.all(phones.map((p) => p.waitForSelector('.answer-card', { timeout: 15000 })));
  await noHScroll(phones[3], 'vote');
  await shot(phones[3], 's03-vote-10');
  await refreshAndCheck(phones[4], '.answer-card', 'vote');
  for (const p of phones) {
    await p.click('.answer-card:not(.mine):not(.filler)');
    await p.click('button:has-text("Vote")');
  }
  await Promise.all(phones.map((p) => p.waitForSelector('.accuse-row', { timeout: 15000 })));
  await noHScroll(phones[5], 'accuse');
  await refreshAndCheck(phones[6], '.accuse-row', 'accuse');
  for (const p of phones) {
    // locators re-resolve after re-renders caused by other phones' heat updates
    await p.locator('.accuse-row:not(.mine) .suspect').nth(0).click();
    await p.locator('.accuse-row:not(.mine) .suspect').nth(1).click();
  }
  await sleep(200);
  await shot(phones[5], 's04-accuse-10');
  for (const p of phones) await p.click('button:has-text("Lock in")');
  await Promise.all(phones.map((p) => p.waitForSelector('.reveal-card', { timeout: 15000 })));
  await sleep(1500);
  await noHScroll(phones[7], 'reveal');
  await refreshAndCheck(phones[8], '.reveal-card', 'reveal');
  await sleep(4000);
  await shot(phones[7], 's05-reveal-10');
  await Promise.all(phones.map((p) => p.waitForSelector('.score-rows', { timeout: 20000 })));
  await noHScroll(phones[0], 'scoreboard');
  await shot(phones[0], 's06-scoreboard-10');
  const errors = phones.flatMap((p) => p.__errors);
  const serverErr = srv.logs.filter((l) => l.startsWith('ERR'));
  console.log('page errors:', errors.length ? errors : 'none', '| server errors:', serverErr.length ? serverErr : 'none');
  assert(errors.length === 0 && serverErr.length === 0, 'no errors');
  console.log('STRESS10 OK');
} catch (err) {
  console.error('STRESS10 FAILED', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
