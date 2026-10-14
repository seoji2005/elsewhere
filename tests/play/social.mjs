// Play scenario: meet a resident, chat, then buy and drink one tea through the HUD.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let browser, step = '페이지 열기: 새 세션과 준비된 화면', expired = false;
const errors = [];
const deadline = setTimeout(() => {
  expired = true;
  void browser?.close();
}, 60_000);
try {
  browser = await chromium.launch({ timeout: 15_000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // A new context has no save: day 1, midnight, empty inventory and 100결.
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(10_000);
  const url = pathToFileURL(resolve('dist-single/index.html'));
  url.searchParams.set('phone', 'people,nest'); // Residents are home at midnight.
  await page.goto(url.href);
  await page.locator('canvas[data-ready="true"]').waitFor();
  const panel = page.locator('.hud-panel');
  const status = page.locator('.hud-status > span');
  const cash = async () => {
    const text = await status.nth(2).innerText();
    assert.match(text, /^\d+결$/, '상단 바에 결 잔액이 표시되어야 함');
    return Number(text.slice(0, -1));
  };
  const energy = async () => {
    const text = await status.nth(3).innerText();
    assert.match(text, /^활력 \d+(?:\.\d+)?$/, '상단 바에 숫자 활력이 표시되어야 함');
    return Number(text.slice(3));
  };

  step = '결폰 열기: 주민·만남 패널 표시';
  await page.getByRole('button', { name: '결폰 닫기', exact: true }).tap();
  assert.equal(await panel.isVisible(), false, '닫은 결폰은 숨겨져야 함');
  await page.getByRole('button', { name: '결폰 열기', exact: true }).tap();
  assert.ok(await panel.isVisible(), '결폰을 열면 패널이 보여야 함');
  await page.getByRole('button', { name: '주민·만남', exact: true }).tap();

  step = '주민 선택: 주민 목록과 비어 있지 않은 첫 대사';
  const residents = panel.locator('.hud-row.tap');
  assert.ok(await residents.count() > 0, '공동집 주민 목록에 한 명 이상 있어야 함');
  await residents.first().tap();
  const speech = panel.locator('.hud-say'), relationship = panel.locator('.hud-name');
  const firstLine = (await speech.innerText()).trim();
  assert.ok(firstLine, '주민을 선택하면 첫 대사가 비어 있지 않아야 함');
  assert.match(await relationship.innerText(), /· (낯섦|아는 사이|친구|호감|연인)$/, '이름 옆에 상대의 관계 단계가 있어야 함');
  const bondScores = panel.locator('.hud-bond');
  const beforeRelationship = await bondScores.innerText();
  assert.match(beforeRelationship, /^호감 -?\d+ · 신뢰 -?\d+$/, '호감과 신뢰 숫자가 작게 표시되어야 함');

  step = '내 마음 선택: 호감 표시와 선택 상태 변경';
  const feelings = panel.locator('.hud-chips').filter({ hasText: '내 마음' });
  await feelings.getByRole('button', { name: '호감', exact: true }).tap();
  assert.match(await feelings.innerText(), /내 마음 · 호감/, '선택한 내 마음이 호감으로 표시되어야 함');
  assert.equal(await feelings.getByRole('button', { name: '호감', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await feelings.getByRole('button', { name: '친구', exact: true }).getAttribute('aria-pressed'), 'false');

  step = '이야기 주제 선택: 대사와 친밀도 표시 변경';
  const topics = panel.locator('.hud-chips').filter({ hasText: '이야기' }).getByRole('button');
  assert.ok(await topics.count() > 0, '이야기에 선택할 주제가 하나 이상 있어야 함');
  await topics.first().tap();
  const nextLine = (await speech.innerText()).trim();
  assert.ok(nextLine, '이야기 뒤에도 대사가 비어 있지 않아야 함');
  assert.notEqual(nextLine, firstLine, '주제를 탭하면 첫 대사에서 응답 대사로 바뀌어야 함');
  const afterRelationship = await bondScores.innerText();
  assert.match(afterRelationship, /^호감 -?\d+ · 신뢰 -?\d+$/, '이야기 뒤에도 호감과 신뢰 숫자가 표시되어야 함');
  assert.notEqual(afterRelationship, beforeRelationship, '이야기 뒤 친밀도 표시가 바뀌어야 함');

  step = '찻방 이동: 일·소비에 잔향 차 판매 표시';
  await page.getByRole('button', { name: '결증·장소', exact: true }).tap();
  await panel.getByRole('button', { name: '잔물결 찻방', exact: true }).tap();
  assert.equal(await status.nth(1).innerText(), '잔물결 찻방', '현재 장소가 찻방이어야 함');
  await page.getByRole('button', { name: '일·소비', exact: true }).tap();
  const teaRows = panel.locator('.hud-row').filter({ hasText: '잔향 차' });
  const sale = teaRows.filter({ has: page.getByRole('button', { name: '사기', exact: true }) });
  const owned = teaRows.filter({ has: page.getByRole('button', { name: '쓰기', exact: true }) });
  assert.equal(await sale.count(), 1, '찻방에서 잔향 차를 살 수 있어야 함');
  assert.equal(await owned.count(), 0, '구매 전 가진 잔향 차는 0개여야 함');

  step = '잔향 차 1개 구매: 결 감소와 가진 물건 1개';
  const beforeBuy = await cash();
  await sale.getByRole('button', { name: '사기', exact: true }).tap();
  assert.ok(await cash() < beforeBuy, '잔향 차 구매 뒤 상단 결이 감소해야 함');
  assert.equal(await owned.count(), 1, '구매한 잔향 차가 가진 물건에 보여야 함');
  assert.equal(await owned.locator('.hud-sub').innerText(), '1개', '가진 잔향 차가 정확히 1개여야 함');

  step = '잔향 차 쓰기: 활력 증가와 가진 물건 0개';
  const beforeUse = await energy();
  await owned.getByRole('button', { name: '쓰기', exact: true }).tap();
  assert.ok(await energy() > beforeUse, '잔향 차를 쓰면 상단 활력이 증가해야 함');
  assert.equal(await owned.count(), 0, '사용 뒤 잔향 차 0개로 가진 물건에서 사라져야 함');
  assert.equal(await panel.locator('.hud-note').filter({ hasText: '아직 없어요.' }).count(), 1,
    '마지막 물건을 쓰면 가진 물건이 비었다는 안내가 보여야 함');
  assert.deepEqual(errors, [], '시나리오 중 브라우저 오류가 없어야 함');
  console.log('Play: 결폰 → 내 마음 선택 → 주민 대화·호감 변경 → 잔향 차 구매 → 사용·활력 증가 PASS');
} catch (error) {
  console.error(`Play social [${step}] FAIL${expired ? ' (전체 60초 초과)' : ''}: ${error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
