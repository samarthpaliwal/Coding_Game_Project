// Full Contraband game in headless Chromium: 3 phones + a TV. Screenshots per phase land in artifacts/.
// Run: node test/e2e/contraband.mjs   (uses fast timers via CONTRABAND_FAST=1)
import { bootServer, launch, phone, tvPage, createRoom, joinRoom, shot, sleep, assert } from './lib.js';

const srv = await bootServer({ CONTRABAND_FAST: '1' });
const browser = await launch();
const errors = [];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function phaseOf(page) {
  return page.evaluate(() => document.body.dataset.phase + ':' + (document.querySelector('main')?.className || ''));
}
async function waitPhase(page, cls, ms = 20000) {
  await page.waitForFunction((c) => document.querySelector(`main.playing .stage ${c}`) || document.querySelector(`main${c}`), cls, { timeout: ms });
}
const gameView = (page) => page.evaluate(() => window.__view?.game?.view || null);

try {
  const ana = await phone(browser, 'ana');
  const code = await createRoom(ana, srv.base, 'Ana');
  const ben = await phone(browser, 'ben');
  await joinRoom(ben, srv.base, code, 'Ben');
  const cy = await phone(browser, 'cy');
  await joinRoom(cy, srv.base, code, 'Cy');
  const tv = await tvPage(browser);
  await tv.goto(`${srv.base}/tv?room=${code}`);
  await tv.waitForSelector('.tv-lobby');
  const phones = [ana, ben, cy];
  await ana.waitForFunction(() => document.querySelectorAll('.player-list .player').length === 3);
  await shot(ana, 'c01-lobby-host');
  // settings: 3 rounds
  await ana.click('.stepper .btn:first-child'); // rounds 4 -> 3
  await ana.waitForFunction(() => document.querySelector('.stepper-val')?.textContent === '3');
  await ana.click('button:has-text("Start Contraband")');

  for (let round = 1; round <= 4; round++) {
    const isFinal = round === 4;
    await Promise.all(phones.map((p) => p.waitForSelector('.role-card', { timeout: 15000 })));
    log(`round ${round}: briefing`);
    const roles = await Promise.all(phones.map((p) => p.evaluate(() => ({ role: document.querySelector('.role-card')?.className.includes('smuggler') ? 'smuggler' : 'clean', word: document.querySelector('.role-word')?.textContent || null }))));
    if (round === 1) {
      await shot(phones.find((_, i) => roles[i].role === 'smuggler') || ana, 'c02-briefing-smuggler');
      await shot(phones.find((_, i) => roles[i].role === 'clean') || ben, 'c03-briefing-clean');
      await shot(tv, 'c04-tv-briefing');
    }
    await Promise.all(phones.map((p) => p.waitForSelector('#answer', { timeout: 15000 })));
    log(`round ${round}: write`);
    if (round === 1) {
      // wiretap: first clean player taps the smuggler
      const si = roles.findIndex((r) => r.role === 'smuggler');
      const ci = roles.findIndex((r) => r.role === 'clean');
      const tapper = phones[ci];
      await tapper.click('button.wiretap');
      await tapper.waitForSelector('.sheet-target');
      const targetName = ['Ana', 'Ben', 'Cy'][si];
      await tapper.click(`.sheet-target:has-text("${targetName}")`);
      await phones[si].fill('#answer', 'I am typing live ');
      await tapper.waitForFunction(() => (document.getElementById('tap-text')?.textContent || '').includes('typing live'), null, { timeout: 5000 });
      await phones[si].waitForSelector('.tapped-banner');
      await shot(tapper, 'c05-write-wiretap-tapper');
      await shot(phones[si], 'c06-write-tapped-smuggler');
      await shot(tv, 'c07-tv-write');
    }
    for (let i = 0; i < phones.length; i++) {
      const p = phones[i];
      const w = roles[i].word;
      const text = w ? `Honestly ${w} was the plan from ${['Ana', 'Ben', 'Cy'][i]}` : `Nothing to see here says ${['Ana', 'Ben', 'Cy'][i]}`;
      await p.fill('#answer', text);
      if (w && round === 1 && i === roles.findIndex((r) => r.role === 'smuggler')) {
        // try submitting without the word first: must be rejected inline
        await p.fill('#answer', 'forgot the word entirely');
        await p.click('button:has-text("Submit")');
        await p.waitForSelector('#toast.show');
        const toast = await p.textContent('#toast');
        assert(toast.includes('must include'), 'missing word toast: ' + toast);
        await p.fill('#answer', text);
      }
      await p.click('button:has-text("Submit")');
      // the last submitter jumps straight into the vote
      await p.waitForSelector('.submitted-answer, .answer-card', { timeout: 5000 });
    }
    await Promise.all(phones.map((p) => p.waitForSelector('.answer-card', { timeout: 15000 })));
    log(`round ${round}: vote`);
    if (round === 1) {
      await shot(ana, 'c08-vote');
      await shot(tv, 'c09-tv-vote');
    }
    for (const p of phones) {
      await p.click('.answer-card:not(.mine):not(.filler)');
      await p.click('button:has-text("Vote")');
    }
    if (!isFinal) {
      await Promise.all(phones.map((p) => p.waitForSelector('.accuse-row', { timeout: 15000 })));
      log(`round ${round}: accuse`);
      for (const p of phones) {
        await p.click('.accuse-row:not(.mine) .suspect');
      }
      await sleep(300);
      if (round === 1) {
        await shot(ana, 'c10-accuse');
        await shot(tv, 'c11-tv-accuse');
      }
      for (const p of phones) await p.click('button:has-text("Lock in")');
    } else {
      await Promise.all(phones.map((p) => p.waitForSelector('.lineup-block', { timeout: 15000 })));
      log('final: lineup');
      for (const p of phones) {
        const blocks = await p.$$('.lineup-block');
        for (let b = 0; b < blocks.length; b++) {
          await p.click(`.lineup-block:nth-child(${b + 1}) .lineup-head`);
          await p.click(`.lineup-block:nth-child(${b + 1}) .tile:first-child`);
        }
      }
      await shot(ana, 'c15-lineup');
      await shot(tv, 'c16-tv-lineup');
      for (const p of phones) await p.click('button:has-text("Lock in")');
    }
    await Promise.all(phones.map((p) => p.waitForSelector('.reveal-card', { timeout: 15000 })));
    log(`round ${round}: reveal`);
    // measure reveal sync: revealAt is in the view; compare each page's local clock offset estimate
    await sleep(2600);
    if (round === 1) {
      await shot(ana, 'c12-reveal');
      await shot(tv, 'c13-tv-reveal');
    }
    if (isFinal) {
      await shot(ana, 'c17-reveal-final');
    } else {
      await Promise.all(phones.map((p) => p.waitForSelector('.score-rows', { timeout: 15000 })));
      log(`round ${round}: scoreboard`);
      if (round === 1) {
        await shot(ana, 'c14-scoreboard');
        await shot(tv, 'c14b-tv-scoreboard');
      }
      if (round === 2) {
        // refresh Ben mid-scoreboard: he must land on the same screen
        await ben.reload();
        await ben.waitForSelector('main.playing', { timeout: 10000 });
      }
    }
  }
  await Promise.all(phones.map((p) => p.waitForSelector('.results', { timeout: 20000 })));
  await tv.waitForSelector('.tv-results', { timeout: 20000 });
  await sleep(2500);
  log('results');
  await shot(ana, 'c18-results');
  await shot(tv, 'c19-tv-results');
  const awards = await ana.$$eval('.award', (els) => els.map((e) => e.textContent.trim().slice(0, 40)));
  log('awards:', awards);
  assert(awards.length >= 2, 'awards rendered');
  // play again from results
  await ana.click('button:has-text("Play again")');
  await Promise.all(phones.map((p) => p.waitForSelector('.role-card', { timeout: 15000 })));
  log('play again works');
  const allErrors = [...phones, tv].flatMap((p) => p.__errors);
  const serverErr = srv.logs.filter((l) => l.startsWith('ERR'));
  console.log('page errors:', allErrors.length ? allErrors : 'none');
  console.log('server errors:', serverErr.length ? serverErr : 'none');
  assert(allErrors.length === 0, 'no page errors');
  assert(serverErr.length === 0, 'no server errors');
  console.log('E2E OK');
} catch (err) {
  console.error('E2E FAILED', err);
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < pages.length; i++) await shot(pages[i], `fail-${i}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
