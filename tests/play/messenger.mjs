// Play scenario (C076): 결폰 → 메신저 → 누엘 → a message at midnight waits for morning → friend-tone reply → 약속 잡기
// puts a real appointment in 주민·만남, and the daily limit stops a fourth message.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let browser, step = '페이지 열기', expired = false;
const errors = [];
const deadline = setTimeout(() => { expired = true; void browser?.close(); }, 300_000);
try {
  browser = await chromium.launch({ timeout: 15_000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(30_000);
  const url = pathToFileURL(resolve('dist-single/index.html'));
  url.searchParams.set('phone', 'chat,nest');
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor();
  const panel = page.locator('.hud-panel'), mine = panel.locator('.hud-msg.me'), theirs = panel.locator('.hud-msg:not(.me)');
  // Edit the save (누엘 as a friend, or a later clock) and reload, as tests/play/social.mjs does.
  const reload = async edit => {
    await page.evaluate(edit => {
      const save = JSON.parse(localStorage.getItem('vworld.session'));
      new Function('state', edit)(save.state);
      localStorage.setItem('vworld.session', JSON.stringify(save));
      addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);
    }, edit);
    await page.reload({ timeout: 45_000 });
    await page.locator('canvas[data-ready="true"]').waitFor();
    await panel.locator('.hud-row.tap').filter({ hasText: /^누엘 · / }).tap();
  };
  mkdirSync('.shots', { recursive: true });

  step = '메신저 탭: 연락처와 누엘(친구) 선택';
  assert.ok(await panel.locator('.hud-row.tap').count() >= 6, '메신저에 주민 연락처가 보여야 함');
  await reload(`state.bonds.edges[JSON.stringify(['nuel', 'player'])] =
    { affection: 40, trust: 25, respect: 0, comfort: 20, romance: 0, met: true };`);
  assert.match(await panel.locator('.hud-name').innerText(), /누엘 · 친구/);

  step = '자정에 안부: 자고 있어서 아침에 답장';
  await panel.getByRole('button', { name: '안부', exact: true }).tap();
  assert.equal(await mine.last().innerText(), '잘 지내요?');
  assert.match(await panel.locator('.hud-wait').innerText(), /자고 있어요 · 아침에 답장/);
  assert.equal(await theirs.count(), 0, '자는 동안에는 답장이 없어야 함');
  assert.ok(await panel.getByRole('button', { name: '약속 잡기', exact: true }).isDisabled(), '답장을 기다리는 동안 보내기 비활성');
  await page.screenshot({ path: '.shots/c076-messenger-asleep.png' });

  step = '아침 8시: 친구 말투 답장';
  await reload('state.world.clock.totalMinutes = state.economyMinute = 8 * 60;');
  await theirs.first().waitFor();
  assert.equal(await theirs.first().innerText(), '응, 잘 지내! 너는?');
  assert.match(await panel.innerText(), /오늘 2번 더 보낼 수 있어요/);

  step = '약속 잡기: 답장에 시간·장소';
  page.setDefaultTimeout(90_000); // a friend answers 10 game minutes later (1 game minute per second)
  await panel.getByRole('button', { name: '약속 잡기', exact: true }).tap();
  await theirs.nth(1).waitFor();
  assert.match(await theirs.nth(1).innerText(), /^좋아! (오늘|내일) \d+시에 .+에서 봐\.$/);
  await page.screenshot({ path: '.shots/c076-messenger-meet.png' });
  page.setDefaultTimeout(30_000);

  step = '하루 연락 상한: 세 번째 뒤 비활성';
  await panel.getByRole('button', { name: '잔향 차 이야기', exact: true }).tap();
  assert.match(await panel.innerText(), /오늘 연락은 여기까지예요/);
  for (const name of ['안부', '잔향 차 이야기', '약속 잡기'])
    assert.ok(await panel.getByRole('button', { name, exact: true }).isDisabled(), `${name} 비활성이어야 함`);

  step = '주민·만남: 약속 목록에 누엘';
  await page.getByRole('button', { name: '주민·만남', exact: true }).tap();
  assert.equal(await panel.locator('.hud-note').filter({ hasText: /^약속 · 누엘 님 · / }).count(), 1, '약속 목록에 누엘 약속이 있어야 함');
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log('Play: 결폰 메신저 → 자는 동안 대기 → 아침 답장(친구 말투) → 약속 잡기 → 약속 목록 · 하루 상한 PASS');
} catch (error) {
  console.error(`Play messenger [${step}] FAIL${expired ? ' (전체 300초 초과)' : ''}: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
