// C102 결폰 '업무' 탭: 제안 카드 목록과 상세(누가·왜 지금·필요한 것·다음 행동 하나). 화면당 결정 하나, 버튼 2~3개.
import type { createSession } from '../game/session';
import type { Npc } from '../data/npcs';
import { answer, askQuestion, askWorry, defOf, inquire, recordCount, review, shown, type OpportunityState } from '../game/tycoon/opportunity';

type Session = ReturnType<typeof createSession>;
type Make = (className: string, parent?: HTMLElement, tag?: string, text?: string) => HTMLElement;
type Button = (parent: HTMLElement, text: string, action: () => string | void) => HTMLElement;
const state = (session: Session) => session.tycoon.state().systems.opportunity as OpportunityState | undefined;
const run = <T>(session: Session, fn: (c: Parameters<Parameters<Session['tycoon']['command']>[1]>[0], s: OpportunityState) => T) =>
  session.tycoon.command('opportunity', fn);

/** 목록·문의 상태가 바뀔 때만 다시 그리도록 hud의 render 키에 넣는다. */
export const workKey = (session: Session) => state(session)?.opps.filter(o => o.status !== 'open').map(o => [o.id, o.status, o.known]) ?? [];

export function workTab(session: Session, h: { body: HTMLElement; residents: readonly Npc[]; make: Make; button: Button;
  row: (label: string, sub: string) => HTMLElement; title: (text: string) => HTMLElement; note: (text: string) => HTMLElement;
  act: (action: () => string | void) => void; selected: string; select: (id: string) => void }) {
  const s = state(session);
  if (!s) return h.note('업무를 불러오지 못했어요.');
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
  for (const x of s.opps.filter(x => x.status === 'accepted').slice(-2)) h.note(`준비 중 · ${who(x.npcId)?.name ?? x.npcId} · ${defOf(x).title} → 함께할 개발자 찾기`);
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
