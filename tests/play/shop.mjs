// Play scenario (C086): 결폰 '내 가게' → 빈 점포 계약 → 찻집 개업 → 잔향 차 주문·값 올리기 → 시간을 빨리 돌려
// 첫 결산 막대 확인 → 직원 구하기: 모르는 사이 거절 이유 → 친구가 된 벨로 수락 → 직원 목록.
// Numbers are not asserted (C087 balances them); only that the screens follow the session API.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { distURL } from '../../tools/serve.mjs';

let browser, step = '페이지 열기', expired = false;
const errors = [];
const deadline = setTimeout(() => { expired = true; void browser?.close(); }, 300_000);
try {
  browser = await chromium.launch({ timeout: 15_000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(30_000);
  const url = new URL(distURL);
  url.searchParams.set('phone', 'shop,cafe');
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor();
  const panel = page.locator('.hud-panel'), tap = name => panel.getByRole('button', { name, exact: true }).first().tap();
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
  // Every visible button in the panel must be finger-sized.
  const fingers = async () => {
    const small = await panel.locator('.hud-body button:visible').evaluateAll(list => list
      .map(b => b.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).length);
    assert.equal(small, 0, '내 가게 버튼은 44px 이상이어야 함');
  };
  mkdirSync('.shots-c086', { recursive: true });

  step = '빈 점포 목록';
  assert.match(await page.locator('.hud-tabs .on').innerText(), /내 가게/);
  assert.equal(await panel.locator('.hud-row').filter({ hasText: /보증금 \d+결 · 하루 임대료 \d+결/ }).count(), 2, '빈 점포 2곳');
  assert.match(await page.locator('.hud-status').innerText(), /[☀☁☂]/, '상단 바 날씨 한 글자');
  await fingers();
  await page.screenshot({ path: '.shots-c086/1-empty.jpg', quality: 85 });

  step = '계약 → 찻집 개업';
  const cash = (await save()).world.ledger.balances.player;
  await panel.locator('.hud-row').filter({ hasText: '찻방 점포' }).getByRole('button', { name: '계약' }).tap();
  assert.ok((await save()).world.ledger.balances.player < cash, '보증금이 빠져야 함');
  await panel.locator('.hud-row').filter({ hasText: /^찻집/ }).getByRole('button', { name: '개업' }).tap();
  assert.equal((await save()).leases[0].businessId, 'shop:lease:0');

  step = '잔향 차 주문 · 값 올리기';
  const tea = panel.locator('.hud-row').filter({ hasText: /^잔향 차/ });
  await tea.getByRole('button', { name: '주문 5' }).tap();
  assert.match(await tea.innerText(), /입고 예정 5/);
  const price = Number((await tea.innerText()).match(/판매가 (\d+)결/)[1]);
  await tea.getByRole('button', { name: '잔향 차 값 올리기' }).tap();
  assert.match(await tea.innerText(), new RegExp(`판매가 ${price + 1}결`));

  step = '하루를 빨리 넘겨 첫 결산';
  await reload('state.world.clock.minutesPerSecond = 240;');
  await page.locator('.hud-open:not(.hud-skip)').tap(); // C094: the clock stops while the 결폰 is open; the reload reopens it
  // Past day 2 02:00 the delivery (24h after ordering) and an hourly autosave are both in the save the reload reads.
  await page.waitForFunction(() => {
    const [, day, hour] = document.querySelector('.hud-status span').textContent.match(/^(\d+)일째 (\d+)/) ?? [];
    return Number(day) * 24 + Number(hour) >= 2 * 24 + 2;
  }, null, { timeout: 120_000 });
  await reload('state.world.clock.minutesPerSecond = 1;');
  const report = (await save()).leases[0].reports[0];
  assert.equal(report.day, 1);
  assert.match(await panel.locator('.shop-bar').first().innerText(), new RegExp(`${report.net > 0 ? '\\+' : ''}${report.net}`));
  assert.match(await tea.innerText(), /^잔향 차\s*5개/, '주문한 차가 입고되어야 함');
  assert.match(await panel.locator('.shop-stats').innerText(), /어제 순이익\s*[+-]?\d+결/);
  await fingers();
  await page.screenshot({ path: '.shots-c086/2-summary.jpg', quality: 85 });
  await panel.locator('.shop-chart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.shots-c086/2b-staff-chart.jpg', quality: 85 });

  step = '직원 구하기: 아는 사이가 아니면 거절';
  await tap('직원 구하기');
  const velo = panel.locator('.hud-row').filter({ hasText: /^벨로 · / });
  await velo.getByRole('button', { name: '제안' }).tap();
  assert.match(await panel.locator('.hud-say').innerText(), /^벨로: “.+”$/);
  assert.equal((await save()).book.employment.filter(e => e.actorId === 'velo' && e.leftAt === null && e.businessId === 'shop:lease:0').length, 0);

  step = '친구가 된 벨로는 수락';
  await reload(`state.bonds.edges[JSON.stringify(['velo', 'player'])] =
    { affection: 40, trust: 30, respect: 20, comfort: 20, romance: 0, met: true };`);
  await tap('직원 구하기');
  await velo.getByRole('button', { name: '제안' }).tap();
  assert.match(await panel.locator('.hud-say').innerText(), /^벨로: “좋아/);
  await fingers();
  await page.screenshot({ path: '.shots-c086/3-hire.jpg', quality: 85 });
  await tap('‹ 가게');
  assert.match(await panel.locator('.hud-row').filter({ hasText: /^벨로/ }).innerText(), /시급 \d+결 · 09:00–17:00 근무/);
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log('Play: 내 가게 → 계약 → 개업 → 주문·값 조정 → 첫 결산 막대 → 직원 제안 거절·수락 PASS');
} catch (error) {
  console.error(`Play shop [${step}] FAIL${expired ? ' (전체 300초 초과)' : ''}: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
