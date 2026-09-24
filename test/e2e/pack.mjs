// Lobby game picker + Cardsmith + Imposter + help overlay in headless Chromium (3 phones).
import { bootServer, launch, phone, tvPage, createRoom, joinRoom, shot, sleep, assert } from './lib.js';

const srv = await bootServer({ CONTRABAND_FAST: '1', CONTRABAND_NO_AI: '1' });
const browser = await launch();
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
try {
  const ana = await phone(browser, 'ana');
  const code = await createRoom(ana, srv.base, 'Ana');
  const ben = await phone(browser, 'ben');
  await joinRoom(ben, srv.base, code, 'Ben');
  const cy = await phone(browser, 'cy');
  await joinRoom(cy, srv.base, code, 'Cy');
  const phones = [ana, ben, cy];
  await ana.waitForFunction(() => document.querySelectorAll('.player-list .player').length === 3);
  const cards = await ana.$$eval('.game-card .g-name', (els) => els.map((e) => e.textContent));
  log('picker shows', cards);
  assert(cards.length === 3, 'three games in the picker');
  // help overlay
  await ana.click('button.help-btn');
  await ana.waitForSelector('.help-panel');
  await shot(ana, 'p00-help');
  await ana.click('.help-panel button:has-text("Got it")');
  // pick Cardsmith, type a theme
  await ana.click('.game-card:has-text("Cardsmith")');
  await ana.waitForSelector('#setting-category');
  await ana.fill('#setting-category', 'our dorm');
  await ana.press('#setting-category', 'Enter');
  await ben.waitForFunction(() => document.querySelector('#setting-category')?.value === 'our dorm');
  await shot(ana, 'p01-lobby-cardsmith');
  await ana.click('button:has-text("Start Cardsmith")');
  await Promise.all(phones.map((p) => p.waitForSelector('#cardtext', { timeout: 10000 })));
  log('forge');
  const quota = await ana.$eval('.prompt-text', (e) => Number(e.textContent.match(/\d+/)[0]));
  for (let i = 0; i < quota; i++) {
    for (const p of phones) {
      await p.fill('#cardtext', `${p.__name} card ${i}`);
      await p.press('#cardtext', 'Enter');
      if (i < quota - 1) await p.waitForFunction((n) => document.querySelectorAll('.my-cards li').length === n, i + 1);
    }
  }
  await shot(ana, 'p02-forge');
  await Promise.all(phones.map((p) => p.waitForSelector('.black-card', { timeout: 10000 })));
  log('pick');
  const judgeName = await ana.$eval('.eyebrow', (e) => e.textContent);
  const nonJudges = [];
  for (const p of phones) {
    const isJudge = await p.$('.done-card:has-text("You judge")');
    if (!isJudge) nonJudges.push(p);
  }
  assert(nonJudges.length === 2, 'two players pick, one judges: ' + judgeName);
  await shot(nonJudges[0], 'p03-hand');
  for (const p of nonJudges) {
    await p.click('.hand .white-card');
    await p.click('button:has-text("Play this card")');
  }
  const judge = phones.find((p) => !nonJudges.includes(p));
  await judge.waitForSelector('button:has-text("Crown it")', { timeout: 10000 });
  await shot(judge, 'p04-judge');
  await judge.click('.choice-list .white-card');
  await judge.click('button:has-text("Crown it")');
  await Promise.all(phones.map((p) => p.waitForSelector('.winner-card', { timeout: 10000 })));
  await shot(ana, 'p05-reveal');
  await ana.click('button:has-text("End game")');
  await ana.waitForSelector('.results', { timeout: 10000 });
  await shot(ana, 'p06-results-cardsmith');
  // Imposter
  await ana.click('button:has-text("Change game")');
  await ana.waitForSelector('.game-card:has-text("Imposter")');
  await ana.click('.game-card:has-text("Imposter")');
  await ana.click('button:has-text("Start Imposter")');
  await Promise.all(phones.map((p) => p.waitForSelector('.role-card.secret', { timeout: 10000 })));
  await shot(ana, 'p07-imposter-secret');
  await Promise.all(phones.map((p) => p.waitForSelector('#imp-text', { timeout: 10000 })));
  for (const p of phones) {
    await p.fill('#imp-text', `${p.__name} thing`);
    await p.press('#imp-text', 'Enter');
  }
  await Promise.all(phones.map((p) => p.waitForSelector('.imp-wall', { timeout: 10000 })));
  await shot(ana, 'p08-imposter-vote');
  for (const p of phones) await p.click('.imp-answer:not(.mine)');
  await Promise.all(phones.map((p) => p.waitForSelector('.count-banner', { timeout: 15000 })));
  await shot(ana, 'p09-imposter-reveal');
  const errors = phones.flatMap((p) => p.__errors);
  const serverErr = srv.logs.filter((l) => l.startsWith('ERR'));
  console.log('page errors:', errors.length ? errors : 'none', '| server errors:', serverErr.length ? serverErr : 'none');
  assert(errors.length === 0 && serverErr.length === 0, 'no errors');
  console.log('PACK OK');
} catch (err) {
  console.error('PACK FAILED', err);
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < pages.length; i++) await shot(pages[i], `pack-fail-${i}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.stop();
}
