// Play scenario (C096): 가게 → 생산자에게 가서 상자 받기 → 가게로 돌아와 뒷방에 내려놓기 → 진열·판매, 3분 안.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { distURL } from '../../tools/serve.mjs';

let browser, step = '페이지 열기', expired = false;
const errors = [];
const deadline = setTimeout(() => { expired = true; void browser?.close(); }, 180_000);
try {
  browser = await chromium.launch({ timeout: 15_000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(30_000);
  const url = new URL(distURL);
  url.searchParams.set('phone', 'shop,shop');
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor();
  const panel = page.locator('.hud-panel'), tab = name => page.locator('.hud-tabs button', { hasText: name }).tap();
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('vworld.session')).state);
  const reload = async edit => {
    await page.evaluate(edit => {
      const save = JSON.parse(localStorage.getItem('vworld.session'));
      new Function('state', edit)(save.state);
      localStorage.setItem('vworld.session', JSON.stringify(save));
      addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);
    }, edit);
    await page.reload({ timeout: 45_000 });
    await page.locator('canvas[data-ready="true"]').waitFor();
  };
  mkdirSync('.shots-c096', { recursive: true });

  step = '교환소 점포 계약 · 찻집 개업 · 직원';
  const hour = () => page.evaluate(() => {
    const [, day, h] = document.querySelector('.hud-status span').textContent.match(/^(\d+)일째 (\d+)/) ?? [];
    return (Number(day) - 1) * 24 + Number(h);
  });
  await reload('state.world.clock.minutesPerSecond = 120;'); // to 07:00 on day 1, then real pace
  await page.locator('.hud-open:not(.hud-skip):not(.hud-mute)').tap(); // C094: the clock stops while the 결폰 is open; the reload reopens it
  await page.waitForFunction(() => /^1일째 (0[7-9]|1[0-4])/.test(document.querySelector('.hud-status span').textContent), null, { timeout: 60_000 }); // producer hours; at ~1fps SwiftShader a frame can skip 2+ game hours
  await reload(`state.world.clock.minutesPerSecond = 1; state.bonds.edges[JSON.stringify(['velo', 'player'])] =
    { affection: 40, trust: 30, respect: 20, comfort: 20, romance: 0, met: true };`);
  await panel.locator('.hud-row').filter({ hasText: '교환소 점포' }).getByRole('button', { name: '계약' }).tap();
  await panel.locator('.hud-row').filter({ hasText: /^찻집/ }).getByRole('button', { name: '개업' }).tap();
  await panel.getByRole('button', { name: '직원 구하기', exact: true }).tap();
  await panel.locator('.hud-row').filter({ hasText: /^벨로 · / }).getByRole('button', { name: '제안' }).tap();
  await panel.getByRole('button', { name: '‹ 가게' }).tap();

  assert.ok(await hour() >= 7 && await hour() < 18, '생산자 영업 시간');
  step = '생산자 위치 안내 → 찾아가기';
  const tea = panel.locator('.hud-row').filter({ hasText: /^잔향 차/ }), order = tea.locator('+ .hud-chips');
  assert.match(await order.innerText(), /배달비 \d+결 · 내일/, '배달 안내');
  const where = (await order.innerText()).match(/생산자 누엘 · 지금 (.+?) \(07–19시\)/)[1];
  await order.getByRole('button', { name: '직접 가지러 가기 · 배달비 0' }).tap();
  assert.match(await page.locator('.toast').innerText(), new RegExp(`누엘 님은 지금 ${where}`));
  await tab('결증·장소');
  await panel.getByRole('button', { name: where, exact: true }).tap();
  await tab('내 가게');

  step = '상자 받기';
  await order.getByRole('button', { name: '상자 받기 5 · 지금' }).tap();
  assert.match(await page.locator('.hud-status').innerText(), /📦×5/, '상단 짐 표시');
  assert.deepEqual((await save()).tycoon.systems.haul.load, { tea: 5 });
  await page.screenshot({ path: '.shots-c096/1-pickup.jpg', quality: 85 });

  step = '가게로 돌아와 뒷방에 내려놓기';
  await tab('결증·장소');
  await panel.getByRole('button', { name: '모아결 교환소', exact: true }).tap();
  await tab('내 가게');
  await panel.getByRole('button', { name: '뒷방에 내려놓기' }).tap();
  assert.doesNotMatch(await page.locator('.hud-status').innerText(), /📦/);
  assert.match(await tea.innerText(), /^잔향 차\s*5개/);
  await page.screenshot({ path: '.shots-c096/2-dropped.jpg', quality: 85 });

  step = '진열 · 판매';
  await reload('state.world.clock.minutesPerSecond = 120;');
  await page.locator('.hud-open:not(.hud-skip):not(.hud-mute)').tap(); // C094: close the 결폰 so the clock runs
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vworld.session')).state.book.businesses
    .find(b => b.id === 'shop:lease:0').store.events.some(e => e.reason === 'purchased'), null, { timeout: 90_000, polling: 1000 });
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log('Play: 가게 → 생산자 → 상자 받기 → 가게 → 뒷방 → 판매 PASS');
} catch (error) {
  console.error(`Play haul [${step}] FAIL${expired ? ' (전체 180초 초과)' : ''}: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
