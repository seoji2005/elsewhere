// Play scenario (C106): ?trial=1 새 체험 세계 → 시작 안내 → 생산자에게 상자 받기 → 가게 뒷방 → 첫 판매(실제 ≤180초)
// → 결폰을 열면 시간 멈춤 → 직원 시험·채용·정책 → 광고 → '다음 일까지'로 공사 예고 대응 → AI 문의 → 저녁 공연. 핵심 화면 7장.
// 조작은 화면 버튼만, page.evaluate는 저장·DOM 읽기만. 도달하지 못한 단계는 이름을 붙여 실패한다.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { distURL } from '../../tools/serve.mjs';

let browser, step = '페이지 열기', expired = false;
const errors = [], log = [];
const deadline = setTimeout(() => { expired = true; void browser?.close(); }, 420_000);
try {
  browser = await chromium.launch({ timeout: 15_000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(30_000);
  const loadStart = performance.now(), url = new URL(distURL);
  url.searchParams.set('trial', '1');
  await page.addInitScript(() => localStorage.getItem('vworld.session') ?? localStorage.setItem('vworld.session', 'main-save')); // 기존 세이브
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 60_000 });
  log.push(`로딩 ${((performance.now() - loadStart) / 1000).toFixed(1)}초`);
  const panel = page.locator('.hud-panel'), phone = page.locator('.hud-open:not(.hud-skip):not(.hud-mute)');
  const tab = name => page.locator('.hud-tabs button', { hasText: name }).tap();
  const tap = (name, exact = true) => panel.getByRole('button', { name, exact }).first().tap();
  const status = () => page.locator('.hud-status').innerText();
  const cash = async () => Number((await status()).match(/(\d+)결/)[1]);
  const clock = async () => (await page.locator('.hud-status span').first().innerText());
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('trial.vworld.session')).state);
  const shot = name => page.screenshot({ path: `.shots-play/${name}.jpg`, quality: 80 });
  const goPlace = async name => { await tab('결증·장소'); await tap(name); await tab('내 가게'); };
  const skip = async () => { await page.locator('.hud-skip').tap(); await page.locator('.hud-ask').getByRole('button', { name: '넘기기' }).tap(); };
  mkdirSync('.shots-play', { recursive: true });

  step = '시작 안내 · 준비된 세계';
  const intro = page.locator('.intro');
  assert.equal(await intro.locator('p').count(), 5, '안내 5줄');
  assert.match(await clock(), /^1일째 07:0/, '07:00 시작');
  assert.match(await status(), /모아결 교환소/, '가게 앞에서 시작');
  assert.match(await page.locator('.build-tag').innerText(), /^빌드 /);
  await intro.getByRole('button', { name: '시작하기' }).tap();
  const t0 = performance.now(); // 조작 가능한 순간부터

  step = '생산자에게 가서 상자 받기';
  await phone.tap(); await tab('내 가게');
  const tea = panel.locator('.hud-row').filter({ hasText: /^잔향 차/ }), order = tea.locator('+ .hud-chips');
  await order.getByRole('button', { name: '직접 가지러 가기 · 배달비 0' }).tap();
  const where = (await order.innerText()).match(/지금 (.+?) \(07–19시\)/)[1];
  await goPlace(where);
  await order.getByRole('button', { name: '상자 받기 5 · 지금' }).tap();
  assert.match(await status(), /📦×5/, '짐 표시');
  await goPlace('모아결 교환소');
  await tap('뒷방에 내려놓기');
  assert.match(await tea.innerText(), /^잔향 차\s*5개/);
  const before = await cash();
  await phone.tap(); // 결폰을 닫아야 시간이 흐른다

  step = '첫 판매';
  await page.waitForFunction(b => Number(document.querySelector('.hud-status').innerText.match(/(\d+)결/)[1]) > b, before,
    { timeout: Math.max(1000, 180_000 - (performance.now() - t0)), polling: 250 });
  const firstSale = (performance.now() - t0) / 1000;
  log.push(`첫 판매 ${firstSale.toFixed(1)}초`);
  await shot('1-first-sale');
  assert.ok(firstSale <= 180, '첫 판매 180초 안');
  assert.equal(await page.evaluate(() => localStorage.getItem('vworld.session')), 'main-save', '기존 세이브를 덮지 않음');

  step = '결폰을 열면 시간 멈춤';
  await phone.tap();
  await page.locator('.hud-pause').waitFor({ timeout: 5000 }); // 멈춤 표시
  const frozen = await clock();
  await page.waitForTimeout(5000);
  assert.equal(await clock(), frozen, '읽는 동안 시각이 그대로');
  await phone.tap();
  await page.waitForFunction(t => document.querySelector('.hud-status span').textContent !== t, frozen, { timeout: 30_000 });

  step = '직원 시험 근무 → 채용 → 정책';
  await phone.tap(); await tab('내 가게');
  await tap('직원 구하기');
  await panel.getByRole('button', { name: /^시험 근무/ }).first().tap();
  for (let i = 0; i < 6 && !await panel.getByRole('button', { name: '이 조건으로 채용' }).isVisible(); i++) { // 시험 60분: 결폰을 닫고 기다린다
    await phone.tap(); await page.waitForTimeout(15_000); await phone.tap(); await tab('내 가게'); await tap('직원 구하기');
  }
  await tap('이 조건으로 채용');
  await tap('추천값 한 번에 적용');
  await shot('2-staff-policy');
  await tap('맡기기');
  assert.equal((await save()).book.employment.filter(e => e.job.employerId === 'player' && e.leftAt === null).length, 1, '채용');

  step = '광고 하나';
  await tap('광고 내기');
  for (let i = 0; i < 5; i++) await tap('고르기');
  await tap('광고 사기');
  await shot('3-ad');
  assert.equal((await save()).tycoon.systems.ads.campaigns.length, 1, '광고 1건');

  step = "'다음 일까지'로 공사 예고 → 대응";
  await phone.tap();
  const city = page.locator('.haggle').filter({ hasText: '07:00부터' });
  for (let i = 0; i < 10 && !await city.isVisible(); i++) { await skip(); await page.waitForTimeout(1500); }
  await city.getByRole('button').first().waitFor();
  await shot('4-roadworks');
  await city.getByRole('button', { name: /주차 제휴|아침 메뉴|그대로 영업/ }).first().tap();
  log.push(`공사 대응 ${await clock()}`);

  step = 'AI 문의 → 제안';
  await phone.tap(); await tab('업무');
  await tap('다른 사업 알아보기');
  await tap('반복 업무 도와주기');
  await shot('5-ai-offer');
  log.push(`AI: ${(await page.locator('.toast').innerText()).trim()}`);

  step = '저녁 공연 표';
  await tab('일·소비');
  await panel.getByRole('button', { name: '혼자 표 사기' }).first().tap();
  await shot('6-show-ticket');
  const s = await save();
  log.push(`지갑 ${s.world.ledger.balances.player}결 · 표 ${s.tycoon.systems.leisure.tickets.length}장`);
  await phone.tap();
  await shot('7-street');
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log(`Play tycoon PASS · ${log.join(' · ')} · 전체 ${((performance.now() - loadStart) / 1000).toFixed(0)}초`);
} catch (error) {
  console.error(`Play tycoon [${step}] FAIL${expired ? ' (전체 420초 초과)' : ''}: ${error.message} · ${log.join(' · ')}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
