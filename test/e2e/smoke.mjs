import { bootServer, launch, phone, tvPage, createRoom, joinRoom, shot, sleep, assert } from './lib.js';

const srv = await bootServer();
const browser = await launch();
try {
  const ana = await phone(browser, 'ana');
  const code = await createRoom(ana, srv.base, 'Ana');
  assert(/^[A-Z]{4}$/.test(code), 'code ' + code);
  const ben = await phone(browser, 'ben');
  await joinRoom(ben, srv.base, code, 'Ben');
  const cy = await phone(browser, 'cy');
  await joinRoom(cy, srv.base, code, 'Cy');
  await ana.waitForFunction(() => document.querySelectorAll('.player-list .player').length === 3);
  const names = await ana.$$eval('.player-list .p-name', (els) => els.map((e) => e.textContent.trim()));
  console.log('players seen by host:', names);
  assert(names[0].startsWith('Ana'), 'host first');
  // refresh Ben: should resume same seat, no duplicate
  await ben.reload();
  await ben.waitForSelector('.lobby');
  await sleep(300);
  const count = await ana.$$eval('.player-list .player', (els) => els.length);
  assert(count === 3, 'still 3 after refresh, got ' + count);
  // QR toggle + TV
  await ana.click('button:has-text("Show QR")');
  await ana.waitForSelector('.qr svg');
  const tv = await tvPage(browser);
  await tv.goto(`${srv.base}/tv?room=${code}`);
  await tv.waitForSelector('.tv-lobby');
  await tv.waitForFunction(() => document.querySelectorAll('.player-list .player').length === 3);
  await shot(ana, 'smoke-lobby-host');
  await shot(ben, 'smoke-lobby-player');
  await shot(tv, 'smoke-tv-lobby');
  // Home screen shot
  const fresh = await phone(browser, 'fresh');
  await fresh.goto(srv.base + '/');
  await shot(fresh, 'smoke-home');
  const errors = [ana, ben, cy, tv, fresh].flatMap((p) => p.__errors);
  console.log('page errors:', errors.length ? errors : 'none');
  console.log('server log:', srv.logs.join('').trim().split('\n').slice(-3).join(' | '));
  assert(errors.length === 0, 'no page errors');
  console.log('SMOKE OK');
} finally {
  await browser.close();
  srv.stop();
}
