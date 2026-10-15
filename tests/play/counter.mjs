// Play scenario (C115): ?trial=1 가게 앞에서 '들어가기' → 계산대 시점(주민 목록 없음) → 손님이 걸어와 줄 서고 머리 위 말풍선
// → 큰 '계산' 버튼을 눌러야만 팔림(한 번에 한 건) → 흥정 손님에겐 '깎아 주기 / 정가' 두 버튼. 폰 가로 스크린샷 3장(.shots-c115/).
// 상자 입고(C096)와 흥정 손님 도착은 이 시나리오의 대상이 아니라 저장에 직접 넣는다.
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
  url.searchParams.set('trial', '1');
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 60_000 });
  const key = 'trial.vworld.session', save = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)).state, key);
  const reload = async edit => {
    await page.evaluate(([k, edit]) => {
      const save = JSON.parse(localStorage.getItem(k));
      new Function('state', edit)(save.state);
      localStorage.setItem(k, JSON.stringify(save));
      addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);
    }, [key, edit]);
    await page.reload({ timeout: 45_000 });
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 60_000 });
  };
  const shop = s => s.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null);
  const sales = async () => shop(await save()).store.events.filter(e => e.reason === 'purchased').length;
  const cash = async () => (await save()).world.ledger.balances.player;
  const desk = page.locator('.counter'), say = page.locator('.head-say:visible');
  mkdirSync('.shots-c115', { recursive: true });

  step = '물건을 뒷방에 두고 가게 앞에서 시작';
  await reload('for (const s of state.book.businesses.find(b => b.ownerId === "player").store.stock) s.backroom += 10;');
  await page.locator('.intro').getByRole('button', { name: '시작하기' }).tap().catch(() => {});

  step = "'들어가기' → 계산대 시점";
  await page.locator('.enter').tap();
  assert.ok(await page.locator('.hud-panel').isHidden(), '주민 목록(결폰)이 열리지 않아야 함');
  assert.match(await page.locator('.toast').innerText(), /계산대/);
  const sold = await sales(); // 들어가기 전(자동 영업)에 팔린 것

  step = '손님이 걸어와 줄 서기';
  await desk.getByRole('button', { name: /^계산 · / }).waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => window.cornerDiagnostics().line > 0 && document.querySelector('.head-say:not([hidden])'), null, { timeout: 60_000 });
  await page.waitForTimeout(8000); // walked into place
  const line = await page.evaluate(() => window.cornerDiagnostics().line);
  assert.ok(line >= 1 && line <= 4, `줄에 보이는 손님 1~4명 (${line})`);
  assert.equal(await sales(), sold, '계산 전에는 팔리지 않음');
  await page.screenshot({ path: '.shots-c115/1-line.jpg', quality: 85 });

  step = '계산 버튼: 엄지 영역 44px+, 누르면 한 번 판매';
  const ring = desk.getByRole('button', { name: /^계산 · / });
  const box = await ring.boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44 && box.x + box.width > 852 / 2 && box.y > 393 / 2, '오른쪽 아래 큰 버튼');
  const price = Number((await ring.innerText()).match(/(\d+)결/)[1]), before = await cash();
  await page.screenshot({ path: '.shots-c115/2-counter.jpg', quality: 85 });
  await ring.tap();
  assert.match(await page.locator('.toast').innerText(), new RegExp(`${price}결 받았어요`));
  assert.equal(await sales(), sold + 1, '한 번 눌러 한 건');
  assert.equal(await cash(), before + price, '가격만큼 받음');

  step = '흥정 손님: 깎아 주기 / 정가';
  await reload(`const b = state.book.businesses.find(b => b.ownerId === "player"), st = b.store.stock[0];
    state.tycoon.systems.patrons.haggles.push({ visitId: b.id + ':haggle:aro:' + (Math.floor(state.world.clock.totalMinutes / 1440) + 1), npcId: 'aro',
      businessId: b.id, itemId: st.itemId, offer: st.price - 1, minute: Math.floor(state.world.clock.totalMinutes) - 20 });
    b.store.visits = b.store.visits.filter(v => v.status !== 'waiting'); // the haggler is first in line`);
  await page.locator('.enter').tap();
  const cut = desk.getByRole('button', { name: /^깎아 주기 \d+결$/ }), full = desk.getByRole('button', { name: /^정가 \d+결$/ });
  await cut.waitFor(); await full.waitFor();
  await page.waitForTimeout(4000);
  assert.ok(await say.count() >= 1, '머리 위 말풍선');
  await page.screenshot({ path: '.shots-c115/3-haggle.jpg', quality: 85 });
  const offer = Number((await cut.innerText()).match(/(\d+)결/)[1]), had = await cash();
  await cut.tap();
  assert.equal(await cash(), had + offer, `깎아 준 값으로 판매 (${await page.locator('.toast').innerText()})`);
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log(`Play counter PASS · 줄 ${line}명 · 계산 ${price}결 · 흥정 ${offer}결`);
} catch (error) {
  console.error(`Play counter [${step}] FAIL${expired ? ' (전체 300초 초과)' : ''}: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
