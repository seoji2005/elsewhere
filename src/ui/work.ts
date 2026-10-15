// C102 결폰 '업무' 탭: 제안 카드 목록과 상세(누가·왜 지금·필요한 것·다음 행동 하나). 화면당 결정 하나, 버튼 2~3개.
import type { createSession } from '../game/session';
import type { Npc } from '../data/npcs';
import { cases, closing, developers, failLine, fixLines, nextLines, scopes, advanceRate, type DevId, type ScopeId } from '../data/aiContracts';
import { classify, preview } from '../sim/aiAutomation';
import { askReuse, begin, busy, canSuccessOnly, confirmMid, fee, followUp, inspect, pickDev, pickScope, refund, results, retryPayment, rework, sign, start,
  type AiState } from '../game/tycoon/aiContracts';
import { answer, askQuestion, askWorry, defOf, inquire, recordCount, review, shown, type OpportunityState } from '../game/tycoon/opportunity';

type Session = ReturnType<typeof createSession>;
type Make = (className: string, parent?: HTMLElement, tag?: string, text?: string) => HTMLElement;
type Button = (parent: HTMLElement, text: string, action: () => string | void, disabled?: boolean) => HTMLElement;
const state = (session: Session) => session.tycoon.state().systems.opportunity as OpportunityState | undefined;
const run = <T>(session: Session, fn: (c: Parameters<Parameters<Session['tycoon']['command']>[1]>[0], s: OpportunityState) => T) =>
  session.tycoon.command('opportunity', fn);
const ai = (session: Session) => session.tycoon.state().systems.aiContract as AiState | undefined;
const runAi = <T>(session: Session, fn: (c: Parameters<Parameters<Session['tycoon']['command']>[1]>[0], s: AiState) => T) =>
  session.tycoon.command('aiContract', fn);

/** 목록·문의 상태가 바뀔 때만 다시 그리도록 hud의 render 키에 넣는다. */
export const workKey = (session: Session) => [state(session)?.opps.filter(o => o.status !== 'open').map(o => [o.id, o.status, o.known]),
  ai(session)?.contracts.map(c => [c.dev, c.scope, c.signed, c.stage, c.reuse, c.asked, Math.floor((c.work - c.left) * 10 / (c.work || 1)), c.owed, c.runs.length, c.next])];

export function workTab(session: Session, h: { body: HTMLElement; residents: readonly Npc[]; make: Make; button: Button;
  row: (label: string, sub: string) => HTMLElement; title: (text: string) => HTMLElement; note: (text: string) => HTMLElement;
  act: (action: () => string | void) => void; selected: string; select: (id: string) => void }) {
  const s = state(session);
  if (!s) return h.note('업무를 불러오지 못했어요.');
  if (h.selected.startsWith('ai|')) return aiView(session, h, h.selected);
  const who = (id: string) => h.residents.find(n => n.id === id), today = session.tycoon.ctx().time.day;
  const o = shown(s).find(o => o.id === h.selected);
  if (o) {
    const d = defOf(o), n = who(o.npcId), head = h.make('hud-head', h.body);
    h.button(head, '‹ 목록', () => h.select(''));
    h.make('hud-name', head, 'div', `${n?.name ?? o.npcId} · ${n?.job ?? ''}`);
    const missing = recordCount(session.tycoon.ctx(), s, o.npcId, 'missingOrder');
    // 화면에는 한 사람의 가장 최근 한 문장과 다음 행동 하나. 지난 이야기·필요한 것은 펼쳐서 본다.
    const heard = [d.worry, ...d.lines, ...d.questions.slice(0, o.known).flatMap(([q, a]) => [`나: ${q}`, a])];
    h.make('hud-say', h.body, 'div', `“${heard.at(-1)}”`);
    const chips = h.make('hud-chips', h.body), q = d.questions[o.known];
    if (q) h.button(chips, q[0], () => { run(session, (c, st) => askQuestion(c, st, o.id)); });
    else h.button(chips, '해 볼게요', () => { run(session, (c, st) => answer(c, st, o.id, true)); h.select(''); return '좋아요! 다음은 함께할 개발자 찾기예요'; });
    h.button(chips, '다음에 또 말해 줘요', () => { run(session, (c, st) => answer(c, st, o.id, false)); h.select(''); return `${n?.name ?? ''} 님: “그래요, 또 얘기할게요.”`; });
    h.note(`왜 지금 · ${missing ? `최근 사흘 동안 주문 ${missing}건이 빠졌어요` : '주문이 빠진 일이 있었어요'} · ${o.until - today}일 안에 답해 주세요`);
    for (const [label, list] of [['지난 이야기', heard.slice(0, -1).map(l => l.startsWith('나:') ? l : `“${l}”`)],
      ['필요한 것 (돈이 아니라 사람·기술·거래처)', d.needs.map(x => `${x.kind} · ${x.text}`)]] as const) {
      const box = h.make('hud-note', h.body, 'details');
      h.make('', box, 'summary', label);
      for (const l of list) h.make('', box, 'div', l);
    }
    return;
  }
  h.title('받은 제안');
  if (!shown(s).length) h.note('아직 받은 제안이 없어요. 단골 이야기를 듣거나 직접 알아보세요.');
  for (const x of shown(s)) {
    const line = h.row(`${who(x.npcId)?.name ?? x.npcId} · ${defOf(x).title}`, `${x.status === 'offered' ? '새 제안' : '검토 중'} · ${x.until - today}일 남음`);
    line.classList.add('tap');
    line.onclick = () => h.act(() => { run(session, (c, st) => review(c, st, x.id)); h.select(x.id); });
  }
  const label = { building: '개발 중', testing: '시험물 나옴', reworking: '고치는 중', awaitingPayment: '잔금 기다림', delivered: '납품 완료', failed: '종료' };
  for (const x of [...s.opps.filter(x => x.status === 'accepted').slice(-2), ...(ai(session)?.contracts.filter(c => c.oppId.endsWith('>next')).slice(-1) ?? [])]) {
    const c = ai(session)?.contracts.find(c => c.oppId === x.id || c === x), npc = 'npcId' in x ? x.npcId : x.clientId;
    const line = h.row(`${who(npc)?.name ?? npc} · ${'npcId' in x ? defOf(x).title : '다음 일감'}`,
      !c ? '함께할 개발자 찾기' : (label as Record<string, string>)[c.stage] ?? (c.signed ? '착수 준비' : '계약 준비 중'));
    line.classList.add('tap');
    line.onclick = () => h.act(() => h.select(`ai|${'npcId' in x ? runAi(session, (cx, st) => start(cx, st, x.id)).id : x.id}|novice`));
  }
  h.title('다른 사업 알아보기');
  const chips = h.make('hud-chips', h.body);
  if (h.selected !== 'ask') return h.button(chips, '다른 사업 알아보기', () => h.select('ask'));
  h.button(chips, '반복 업무 도와주기', () => {
    const found = run(session, (c, st) => inquire(c, st, 'ai'));
    h.select(found?.id ?? '');
    return found ? `${who(found.npcId)?.name ?? ''} 님이 답했어요` : '아직 답한 사람이 없어요. 내일 다시 볼게요';
  });
  h.note('다른 산업은 곧 열려요. 문의에 돈은 들지 않아요.');
}

/** 내 가게 안: 단골이 구매를 마치고 고민을 한마디. '무슨 일 있어요?'를 누르면 업무 탭 제안으로 이어진다. */
export function worryUi(session: Session, box: HTMLElement, residents: readonly Npc[], inside: boolean,
  act: (action: () => string | void) => void, open: (oppId: string) => void) {
  const w = inside ? state(session)?.worry : null;
  box.hidden = !w || box.dataset.skip === w.oppId;
  if (!w || box.dataset.opp === w.oppId) return;
  box.dataset.opp = w.oppId; box.replaceChildren();
  const d = defOf(state(session)!.opps.find(o => o.id === w.oppId)!), btns = document.createElement('div');
  box.append(`${residents.find(n => n.id === w.npcId)?.name ?? w.npcId}: “${d.worry}”`, btns);
  btns.className = 'haggle-btns';
  for (const [text, fn] of [['무슨 일 있어요?', () => open(run(session, (c, st) => askWorry(c, st)).id)], ['다음에요', () => { box.dataset.skip = w.oppId; }]] as const) {
    const b = document.createElement('button'); b.className = 'hud-btn'; b.textContent = text; b.onclick = () => act(fn); btns.append(b);
  }
}

type Hud = Parameters<typeof workTab>[1];
const legsNote = (c: AiState['contracts'][number]) => { const p = scopes[c.scope!].price;
  return c.pay === 'successOnly' ? `${p}결` : `${p - Math.round(p * advanceRate)}결`; };
const contractItems = (s: AiState, c: AiState['contracts'][number], name: (id: string) => string) => {
  const price = scopes[c.scope!].price, adv = Math.round(price * advanceRate), d = developers[c.dev!], half = Math.floor(fee(c) / 2);
  return [`고객 계정 · ${name(c.clientId)}`, '수취 계정 · 나(개인)', `개발자 계정 · ${name(s.devs[c.dev!])}`, `범위 · ${scopes[c.scope!].name} (버전 ${c.version})`,
    `가격 · ${price}결`, `선금 · ${adv}결(착수 때) / 성공보수면 선금 없음, 성공 때 ${price}결 받고 개발자에게 ${d.successFee ?? '-'}결`,
    `작업 · ${d.work[c.scope!]![0]}분, 개발자 근무 ${d.hours[0]}~${d.hours[1]}시에만`, `검수 사례 · 대표 ${cases.length}건 + 안전 사례`, '재작업 · 1회 포함',
    `실패 정산 · 선금 계약이면 착수비 ${half}결을 뺀 ${adv - half}결 환급, 성공보수면 양쪽 0결`,
    `데이터 · 개발자는 주문번호·상품·수량만, 납품 7일 뒤 사본 삭제 · 다른 고객 재사용 ${c.reuse ? '고객 동의함' : c.reuse === false ? '고객 거절' : '없음'}`];
};

/** AI 계약 화면: 사람 한 명·한 문장·버튼 2~3개, 하단에 지금 할 일 하나. 조항은 '계약서 펼치기'에서만. */
function aiView(session: Session, h: Hud, selected: string) {
  const [, id, peek] = selected.split('|'), s = ai(session), c = s?.contracts.find(c => c.id === id);
  if (!s || !c) return h.select('');
  const name = (npcId: string) => h.residents.find(n => n.id === npcId)?.name ?? npcId, head = h.make('hud-head', h.body);
  h.button(head, '‹ 목록', () => h.select(''));
  const say = h.make('hud-say', h.body), chips = h.make('hud-chips', h.body);
  const person = (npcId: string, role: string, line: string) => { h.make('hud-name', head, 'div', `${name(npcId)} · ${role}`); say.textContent = `“${line}”`; };
  const run = <T>(fn: Parameters<typeof runAi<T>>[1]) => runAi(session, fn);
  const dev = c.dev && developers[c.dev], price = c.scope ? scopes[c.scope].price : 0;
  let now = '';
  if (!dev) {
    const d: DevId = peek === 'senior' ? 'senior' : 'novice', x = developers[d], taken = busy(s, d, c.id);
    person(s.devs[d], x.label, taken ? '지금은 다른 일을 하고 있어요.' : x.line);
    h.button(chips, '이 사람과 할게요', () => { run((cx, st) => pickDev(cx, st, id, d)); }, taken);
    h.button(chips, '다른 사람 보기', () => h.select(`ai|${id}|${d === 'novice' ? 'senior' : 'novice'}`));
    h.note(`근무 ${x.hours[0]}~${x.hours[1]}시 · 맡는 범위 ${Object.keys(x.work).map(k => scopes[k as ScopeId].name).join('·')}`);
    now = '함께할 개발자 고르기';
  } else if (!c.scope) {
    person(s.devs[c.dev!], dev.label, '어디까지 자동으로 맡길까요? 주소 없는 주문은 늘 사장님 확인이에요.');
    const ids = Object.keys(dev.work) as ScopeId[];
    for (const k of ids) { const p = preview(k); h.button(chips, `${scopes[k].name} · 자동 ${p.auto}건 / 사람 확인 ${p.check}건`, () => { run((cx, st) => pickScope(cx, st, id, k)); }); }
    const box = h.make('hud-note', h.body, 'details');
    h.make('', box, 'summary', `대표 ${cases.length}건 미리보기 (${ids.map(k => scopes[k].name).join(' / ')})`);
    for (const x of cases) h.make('', box, 'div', `${x.text} → ${ids.map(k => classify(k, x) === 'auto' ? '자동' : '확인').join(' / ')}`);
    now = '처리 범위 고르기';
  } else if (!c.signed) {
    person(c.clientId, '고객', `${scopes[c.scope].name} ${price}결로 해요. 선금 ${Math.round(price * advanceRate)}결은 착수 때 드릴게요.`);
    h.button(chips, '선금 계약 서명', () => { run((cx, st) => sign(cx, st, id, 'advance')); });
    if (canSuccessOnly(c)) h.button(chips, '성공보수로 (첫 실적 공동 제작)', () => { run((cx, st) => sign(cx, st, id, 'successOnly')); });
    const box = h.make('hud-note', h.body, 'details');
    h.make('', box, 'summary', '계약서 펼치기');
    for (const line of contractItems(s, c, name)) h.make('', box, 'div', line);
    if (c.reuse === null) h.button(box, '다른 고객 재사용도 물어보기', () => run((cx, st) => askReuse(cx, st, id)) ? '고객: “그 정도는 괜찮아요.”' : '고객: “우리 주문은 우리 일에만 써 주세요.”');
    now = '계약 서명';
  } else if (c.stage === 'scoping' || c.stage === 'awaitingFunding') {
    person(s.devs[c.dev!], dev.label, c.stage === 'awaitingFunding' ? '선금이 아직 오가지 못했어요. 준비되면 다시 시작해요.'
      : c.pay === 'successOnly' ? '지급 없이 일정만 잡을게요. 시작할까요?' : `착수하면 선금이 들어오고 제 착수비 ${Math.floor(fee(c) / 2)}결이 나가요.`);
    h.button(chips, '착수', () => run((cx, st) => begin(cx, st, id)) ? '개발이 시작됐어요' : '선금을 주고받지 못했어요');
    now = '착수';
  } else if (c.stage === 'building' && c.asked === 1) {
    person(s.devs[c.dev!], dev.label, `반쯤 했어요. “${cases.find(x => x.kind === 'missing')!.text}” 이 주문은 사람이 확인하는 게 맞죠?`);
    h.button(chips, '네, 사람이 확인해요', () => { run((cx, st) => confirmMid(cx, st, id)); });
    now = '중간 확인 답하기';
  } else if (c.stage === 'testing') {
    // 검수: 결과는 '통과 n / 확인 필요 n' 한 줄, 실패 사례는 펼쳐서(입력·기대·실제·사람 확인 여부).
    const all = results(c), fails = all.filter(r => !r.ok), f = fails[0];
    if (!f) person(c.clientId, '고객', '약속한 대로 나왔네요. 주소 없는 주문도 확인 목록에 남았어요.');
    else if (c.reworked) person(c.clientId, '고객', failLine);
    else person(s.devs[c.dev!], dev.label, `‘${f.text}’ → ${f.actual}. 어떻게 고칠까요?`);
    if (!f) h.button(chips, '통과 · 잔금 청구', () => { run((cx, st) => inspect(cx, st, id)); });
    else if (c.reworked) h.button(chips, '여기서 끝내기 · 환급', () => { run((cx, st) => inspect(cx, st, id)); });
    else {
      const other = Object.keys(fixLines).find(k => k !== f.feature && k !== 'list') ?? 'list', groups = [...new Set(fails.map(r => r.feature))];
      for (const k of [f.feature, other]) h.button(chips, `“${fixLines[k]}”`, () => { run((cx, st) => rework(cx, st, id, [k])); return '재작업 30분, 근무 시간에 고쳐요'; });
      if (groups.length > 1) h.button(chips, '실패한 것 전부 고쳐 주세요', () => { run((cx, st) => rework(cx, st, id, groups)); });
    }
    chips.before(h.make('hud-verdict', h.body, 'div', `통과 ${all.length - fails.length} / 확인 필요 ${fails.length}`));
    if (fails.length) {
      const box = h.make('hud-note', h.body, 'details');
      h.make('', box, 'summary', `실패 사례 ${fails.length}건 펼치기`);
      for (const r of fails) h.make('', box, 'div', `${r.text} · 기대 ${r.expected} → 실제 ${r.actual}${r.expected === '사람 확인' ? ' · 사람 확인 사례' : ''}`);
    }
    now = !f ? '검수 통과시키기' : c.reworked ? '계약 끝내기' : '고칠 곳 고르기(재작업 1회 포함)';
  } else if (c.stage === 'awaitingPayment') {
    person(c.clientId, '고객', '검수는 통과예요. 잔금은 돈이 들어오면 바로 드릴게요.');
    h.button(chips, '다시 청구하기', () => run((cx, st) => retryPayment(cx, st, id)) ? '잔금이 들어왔어요' : '아직 잔금이 없대요. 내일 다시 받아요');
    h.note(`잔금 ${legsNote(c)} · 받기 전에는 사용권이 열리지 않아요`);
    now = '잔금 기다리기';
  } else if (c.stage === 'delivered' || c.stage === 'failed') {
    const ok = c.stage === 'delivered', r = c.runs.at(-1);
    person(c.clientId, '고객', !ok ? failLine : c.next ? nextLines[c.next]! : closing[c.scope]);
    if (ok && c.next) h.button(chips, `${scopes[c.next].name} 이야기 듣기 (새 계약)`, () => h.select(`ai|${run((cx, st) => followUp(cx, st, id)).id}|novice`));
    h.make('hud-verdict', h.body, 'div', ok ? `정산 끝 · 받은 돈 ${price}결, 개발자에게 ${c.pay === 'successOnly' ? dev.successFee : fee(c)}결`
      : `환급 ${refund(s, c) - c.owed}결${c.owed ? ` · 남은 채무 ${c.owed}결` : ''} · 개발자 착수비는 한 일 값으로 남아요`);
    if (ok) h.note(r ? `어제 실제 주문 · 자동 ${r.auto}건 / 사람 확인 ${r.check}건(${r.minutes}분)` : '내일부터 실제 주문 처리 기록이 쌓여요');
    now = ok ? (c.next ? '다음 일감 듣기' : '납품 완료') : `종료 · ${c.cause}`;
  } else {
    person(s.devs[c.dev!], dev.label, `${c.stage === 'reworking' ? '고치는 중이에요. ' : ''}${Math.floor((c.work - c.left) * 100 / c.work)}% 했어요. ${dev.hours[0]}~${dev.hours[1]}시에만 작업해요.`);
    now = '다음 일까지 넘기며 기다리기';
  }
  h.make('hud-now', h.body, 'div', `지금 할 일 · ${now}`);
}
