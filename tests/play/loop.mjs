// Play scenario: earn, buy one share, then restore the same session after reload.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { distURL } from '../../tools/serve.mjs';

let browser, step = '페이지 열기', expired = false;
const errors = [];
const deadline = setTimeout(() => {
  expired = true;
  void browser?.close();
}, 200_000); // server SwiftShader: one reload of the 9MB build takes ~8-11s
try {
  browser = await chromium.launch({ timeout: 15_000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(15_000); // Allow slow SwiftShader frames; cap the whole scenario at 60 seconds.
  const url = new URL(distURL);
  url.searchParams.set('phone', 'people,cafe'); // Use the supported location shortcut, without changing session data.
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor();
  assert.equal(await page.evaluate(() => window.cornerDiagnostics().place), 'cafe', '찻방에 있어야 함');
  const panel = page.locator('.hud-panel');
  const status = page.locator('.hud-status > span');
  const cash = async () => {
    const text = await status.nth(2).innerText();
    assert.match(text, /^\d+결$/, '상단 바에 결 잔액이 표시되어야 함');
    return Number(text.slice(0, -1));
  };
  const time = async () => {
    const text = await status.nth(0).innerText();
    const match = text.match(/^(\d+)일째 (\d{2}):(\d{2})$/);
    assert.ok(match, `상단 바 시각 형식이 올바라야 함: ${text}`);
    return (Number(match[1]) - 1) * 1440 + Number(match[2]) * 60 + Number(match[3]);
  };
  const saved = () => page.evaluate(() => {
    const raw = localStorage.getItem('vworld.session');
    if (!raw) throw Error('localStorage에 vworld.session 저장이 있어야 함');
    return JSON.parse(raw).state;
  });

  step = '결폰 열기';
  await page.getByRole('button', { name: '결폰 닫기', exact: true }).click();
  assert.equal(await panel.isVisible(), false, '닫은 결폰이 숨겨져야 함');
  await page.getByRole('button', { name: '결폰 열기', exact: true }).click();
  assert.ok(await panel.isVisible(), '결폰 패널이 열려야 함');

  step = '일·소비에서 일하기: 상단 결 증가';
  await page.getByRole('button', { name: '일·소비', exact: true }).click();
  const beforeWork = await cash(), beforeTime = await time();
  const job = panel.locator('.hud-row').filter({ hasText: '잔물결 찻방 돕기' });
  await job.getByRole('button', { name: '일하기', exact: true }).click();
  assert.equal(await cash(), beforeWork + 30, '1시간 일한 뒤 상단 결이 30 증가해야 함');
  assert.ok(await time() >= beforeTime + 60, '근무한 60분이 시각에 반영되어야 함');

  step = '결증에서 1주 매수: 결 감소·보유 1주';
  await page.getByRole('button', { name: '결증·장소', exact: true }).click();
  const company = panel.locator('.hud-row').filter({ hasText: '빛고리 빛씨' });
  assert.match(await company.innerText(), /· 0주/, '매수 전 보유량은 0주여야 함');
  const beforeBuy = await cash();
  await company.getByRole('button', { name: '사기', exact: true }).click();
  const afterBuy = await cash();
  assert.ok(afterBuy < beforeBuy, `매수 뒤 결이 감소해야 함: ${beforeBuy} → ${afterBuy}`);
  assert.match(await company.innerText(), /· 1주/, '매수 뒤 보유량은 1주여야 함');

  step = 'localStorage 저장: 매수 결과 포함';
  // No subsequent action or visibilitychange may save the purchase for us.
  const snapshot = await saved();
  assert.equal(snapshot.world.ledger.balances.player, afterBuy, '저장된 결이 매수 뒤 잔액과 같아야 함');
  assert.equal(snapshot.market.holdings.player.light, 1, '저장에 빛고리 빛씨 1주가 있어야 함');
  assert.ok(snapshot.world.clock.totalMinutes >= beforeTime + 60, '저장 시각에 근무 시간이 포함되어야 함');
  const savedAt = Date.now();

  step = '새로고침: 시각·결·보유 복원';
  // Remove the shortcut so startup cannot overwrite a failed restoration with another location save.
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
  await page.evaluate(() => addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true));
  await page.reload({ timeout: 45_000 });
  await page.locator('canvas[data-ready="true"]').waitFor();
  assert.equal(await cash(), afterBuy, '새로고침 뒤 상단 결이 유지되어야 함');
  const restoredTime = await time(), savedMinute = Math.floor(snapshot.world.clock.totalMinutes);
  const elapsedMinutes = Math.ceil((Date.now() - savedAt) / 1000) + 2; // Default: one game minute per real second.
  assert.ok(restoredTime >= savedMinute && restoredTime <= savedMinute + elapsedMinutes,
    `복원 시각은 저장 시각 ${savedMinute}분부터 경과 시간 안이어야 함: ${restoredTime}분`);
  assert.equal(await page.evaluate(() => window.cornerDiagnostics().place), snapshot.player.placeId,
    '새로고침 뒤 저장 장소가 유지되어야 함');
  const restoredPlayer = await page.evaluate(() => window.cornerDiagnostics().player);
  assert.ok(Math.hypot(restoredPlayer[0] - snapshot.player.x, restoredPlayer[2] - snapshot.player.z) < 0.5,
    '저장된 좌표에서 시작해야 함');
  await page.getByRole('button', { name: '결폰 열기', exact: true }).click();
  await page.getByRole('button', { name: '결증·장소', exact: true }).click();
  assert.match(await company.innerText(), /· 1주/, '새로고침 뒤 화면에 보유 1주가 복원되어야 함');
  step = '문 들어가기 → 멀리 걷기 → 거리로 변경';
  await page.getByRole('button', { name: '결폰 닫기', exact: true }).click();
  await page.getByRole('button', { name: '잔물결 찻방 들어가기', exact: true }).click();
  assert.equal(await status.nth(1).innerText(), '잔물결 찻방');
  await page.getByRole('button', { name: '결폰 닫기', exact: true }).click();
  await page.keyboard.down('Shift');
  await page.keyboard.down('s');
  await page.waitForFunction(() => window.cornerDiagnostics().place === 'street', null, { timeout: 90_000 }); // running 6m at ~1fps SwiftShader
  await page.keyboard.up('s');
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => document.querySelector('.hud-status > span:nth-child(2)').textContent === '거리');
  await page.getByRole('button', { name: '결폰 열기', exact: true }).click();
  await page.getByRole('button', { name: '일·소비', exact: true }).click();
  assert.ok(await job.getByRole('button', { name: '일하기', exact: true }).isDisabled(), '찻방을 떠나면 근무 불가');
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log('Play: 결폰 → 일하기(+30결) → 1주 매수 → 저장 → 새로고침 복원 PASS');
} catch (error) {
  console.error(`Play loop [${step}] FAIL${expired ? ' (전체 60초 초과)' : ''}: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
