import './hud.css';
import { places } from '../data/places';
import { jobs, type Job } from '../data/jobs';
import { items } from '../data/items';
import { companies } from '../data/companies';
import type { Door } from '../data/doors';
import type { Npc } from '../data/npcs';
import type { GeneratedNpc } from '../sim/npcgen';
import { gameTime, type GameTime } from '../sim/clock';
import { applyBondEvent, reactionEffect, readBond, stageOf, friendly, canStartDating } from '../sim/bonds';
import { relationshipStage, type Interaction } from '../sim/relationship';
import { useItem } from '../sim/shop';
import { respondToMatch } from '../sim/matchmaking';
import { restock, visitStore } from '../sim/store';
import { checkoutBusiness, type Business } from '../sim/business';
import { trade } from '../sim/market';
import { asleep, sentToday, waiting, DAILY_LIMIT } from '../sim/messenger';
import type { createSession } from '../game/session';
import { shopKey, shopStatus, shopTab } from './shop';
import { answerHaggle, type PatronState } from '../game/tycoon/patrons';
import { shows } from '../data/shows';
import { npcs } from '../data/npcs';
import { leisure } from '../game/tycoon/leisure';
import { currentEvent, readNotice, respond } from '../game/tycoon/cityEvents';
import type { CityState } from '../sim/cityEvents';
import { cityLines, partnerLot, roadworks } from '../data/cityEvents';
import { parkingSpaces } from '../game/tycoon/patrons';
import { workKey, workTab, worryUi } from './work';
import { crowdOf, guessUsual, type SceneState } from '../game/tycoon/scene';
import { crowdLevels, sceneLines } from '../data/shopScene';
import { personas } from '../data/personas';
import { ding, isMuted, setMuted } from './sound';

type Session = ReturnType<typeof createSession>;
const tabs = { people: '주민·만남', work: '일·소비', stock: '결증·장소', chat: '메신저', shop: '내 가게', biz: '업무' } as const;
type Tab = keyof typeof tabs;
const placeName = (id: string) => places.find(p => p.id === id)?.name ?? (id === 'street' ? '거리' : id);
const two = (n: number) => String(n).padStart(2, '0');
const clock = (t: GameTime) => `${t.day}일째 ${two(t.hour)}:${two(t.minute)}`;
const problems: Record<string, string> = {
  'Outside work hours': '지금은 근무 시간이 아니에요', 'Unfinished shift': '끝나지 않은 근무가 있어요',
  'Insufficient funds': '결이 모자라요', 'Not acquainted': '아는 사이부터 함께 갈 수 있어요', 'Show over': '공연이 끝났어요', unaffordable: '결이 모자라요', 'Savings reserved': '결이 모자라요',
  missing: '물건이 다 떨어졌어요', expensive: '값이 너무 올랐어요', 'Not queue head': '앞 손님이 계산 중이에요',
  'Not negotiable': '이 조항은 빼기 어렵대요', 'Contract unavailable': '이미 서명한 계약서예요',
};

// Thumb UI over the canvas: joystick ring, door button, toast, status bar and the 결폰 panel driving the session.
export function hud(session: Session, residents: readonly (Npc | GeneratedNpc)[], location: {
  move: (placeId: string) => void; sync: () => void; talk: (npc: Npc) => void; warm: (npc: Npc) => void;
}) {
  const { state } = session;
  const make = (className: string, parent: HTMLElement = document.body, tag = 'div', text = '') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  };
  const stick = make('stick'), knob = make('knob', stick);
  const enter = make('enter', document.body, 'button'), toast = make('toast');
  const top = make('hud-top'), status = make('hud-status', top);
  const [timeText, placeText, cashText, energyText, weatherText, warnText, loadText] = [0, 1, 2, 3, 4, 5, 6].map(() => make('', status, 'span'));
  warnText.className = 'hud-warn';
  weatherText.className = 'hud-weather';
  const pause = make('hud-pause', status, 'span', '멈춤'), skip = make('hud-open hud-skip', top, 'button', '다음 일까지 ▶▶');
  const phone = make('hud-open', top, 'button', '결폰 열기');
  // GDD §2: skipping asks first with one line — where it stops and why.
  const ask = make('hud-ask'), askText = make('', ask, 'span');
  let skipTarget = 0;
  const panel = make('hud-panel'), tabBar = make('hud-tabs', panel), body = make('hud-body', panel);
  enter.hidden = panel.hidden = ask.hidden = pause.hidden = true;
  let tab: Tab = 'people', selected = '', said = '', nearDoor: Door | undefined, timer = 0, shown = '';
  let pending = false;
  const pointers = new Set<number>();
  let updates: (() => void)[] = [];
  const live = (element: Node, text: () => string) => {
    const update = () => { const next = text(); if (element.textContent !== next) element.textContent = next; };
    updates.push(update);
    update();
    return element;
  };
  panel.addEventListener('pointerdown', event => pointers.add(event.pointerId), true);
  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    // The click following pointerup must reach the original button before a deferred rebuild.
    window.setTimeout(() => render(), 0);
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  const say = (text: string) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = window.setTimeout(() => toast.classList.remove('show'), 1800);
  };
  const now = () => gameTime(state.world.clock);
  const uid = (kind: string) => `${kind}:player:${Math.floor(state.world.clock.totalMinutes)}:${Math.random().toString(36).slice(2, 8)}`;
  const value = (npc: Npc) => state.world.relationships.player?.[npc.id] ?? 0;
  const incoming = (npc: Npc) => readBond(state.bonds, npc.id, 'player');
  const stage = (npc: Npc) => {
    const name = state.relationMode === 'bonds' ? stageOf(state.bonds, npc.id, 'player', state.dialogue)
      : relationshipStage(value(npc));
    return name === '연인 첫 단계' ? '연인' : name;
  };
  const scores = (npc: Npc) => `호감 ${Math.round(incoming(npc).affection)} · 신뢰 ${Math.round(incoming(npc).trust)}`;
  const feeling = (npc: Npc) => {
    const { romance, affection } = readBond(state.bonds, 'player', npc.id);
    return romance >= 60 ? 'love' : romance >= 40 ? 'crush' : affection >= 30 ? 'friend' : 'unset';
  };
  const fun = leisure(session), hm = (m: number) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;
  const owned = () => items.filter(item => (state.shop.residents.player?.inventory[item.id] ?? 0) > 0);
  // Every action re-renders; a returned string is toasted, a thrown sim error becomes a short Korean reason.
  const act = (action: () => string | void) => {
    try { const text = action(); if (text) say(text); }
    catch (error) { say(problems[(error as Error).message] ?? '지금은 할 수 없어요'); }
    location.sync();
    if (!session.saveNow().ok) say('저장하지 못했어요');
    render(true);
  };
  const button = (parent: HTMLElement, text: string, action: () => string | void, disabled: boolean | (() => boolean) = false) => {
    const element = make('hud-btn', parent, 'button', text) as HTMLButtonElement;
    const update = () => { element.disabled = typeof disabled === 'function' ? disabled() : disabled; };
    updates.push(update);
    update();
    element.onclick = () => act(action);
    return element;
  };
  const row = (label: string, sub: string | (() => string)) => {
    const line = make('hud-row', body), text = make('hud-label', line, 'div', label);
    const detail = make('hud-sub', text, 'span', typeof sub === 'string' ? sub : '');
    if (typeof sub === 'function') live(detail, sub);
    return line;
  };
  const title = (text: string) => make('hud-title', body, 'div', text);
  const note = (text: string) => make('hud-note', body, 'div', text);
  function go(placeId: string) {
    location.move(placeId);
    state.player.placeId = placeId;
    if (state.world.people.player) state.world.people.player.placeId = placeId;
    selected = '';
  }
  function show(next: Tab | '') {
    panel.hidden = !next;
    if (next) tab = next;
    phone.textContent = next ? '결폰 닫기' : '결폰 열기';
    enter.hidden = !nearDoor || !panel.hidden;
    render(true);
  }
  phone.onclick = () => show(panel.hidden ? tab : '');
  skip.onclick = () => {
    show('');
    const next = session.nextEvent();
    skipTarget = next.minute; askText.textContent = `${next.reason} 넘길까요?`; ask.hidden = false;
  };
  make('hud-btn', ask, 'button', '넘기기').onclick = () => act(() => { ask.hidden = true; session.skipTo(skipTarget); });
  make('hud-btn', ask, 'button', '취소').onclick = () => { ask.hidden = true; };
  for (const id of Object.keys(tabs) as Tab[]) make('', tabBar, 'button', tabs[id]).onclick = () => { selected = ''; show(id); };
  enter.onclick = () => act(() => {
    if (!nearDoor) return;
    go(nearDoor.placeId);
    show('people');
    return `${placeName(nearDoor.placeId)}에 들어왔어요`;
  });

  // Lines come from the session's social API (rumours, generated residents); any refusal shows a quiet fallback.
  const fallback = (npc: Npc) => `${npc.name} 님이 고개를 끄덕여요.`;
  const bond = (id: string, entry: Interaction) => applyBondEvent(state.bonds, id, entry.time, [reactionEffect(entry)]);
  const appointments = () => state.matchmaking.appointments.filter(a => a.status === 'scheduled' || a.status === 'offered');
  const speak = (npc: Npc, line: () => string) => () => { try { said = line(); } catch { said = fallback(npc); } };
  function match(npc: Npc) {
    if (appointments().length) return '아직 끝나지 않은 약속이 있어요';
    // The player profile is not stored yet: their interests are the topics they have chatted about happily.
    const likes = [...new Set(state.relationships.interactions
      .filter(i => i.actorId === 'player' && i.change > 0).map(i => i.choice.topic))];
    const minute = (Math.floor(state.world.clock.totalMinutes / 60) + 2) * 60;
    const time = { day: Math.floor(minute / 1440) + 1, hour: Math.floor(minute % 1440 / 60), minute: 0 };
    const appearances = Object.fromEntries(residents.map(n => [n.id, 'appearance' in n ? n.appearance : { age: n.age, job: n.job }]));
    const id = uid('match');
    for (const place of places) {
      const date = session.requestMatch({ id, introducerId: npc.id, npcs: residents, now: now(), player: { id: 'player',
        traits: [], likes, dislikes: [], reputation: 0, lifestyle: { appearance: state.shop.residents.player?.appearance ?? 0 } },
        slot: { placeId: place.id, time }, appearances });
      if (!date) continue;
      return respondToMatch(date, true, now()) === 'scheduled'
        ? `${date.impression.note}\n${clock(time)}, ${place.name}에서 만나요.`
        : `${date.impression.name} 님은 이번엔 어렵대요.`;
    }
    return '지금은 소개해 줄 사람이 떠오르지 않네요.';
  }
  function person(npc: Npc) {
    location.warm(npc); // the resident's avatar loads while the player reads, so 이야기하기 opens at once
    const head = make('hud-head', body);
    button(head, '‹ 목록', () => { selected = ''; });
    live(make('hud-name', head), () => `${npc.name} · ${stage(npc)}`);
    live(make('hud-sub hud-bond', body), () => scores(npc));
    make('hud-say', body, 'div', said);
    const feelings = make('hud-chips', body);
    live(make('hud-sub', feelings, 'span'), () => `내 마음 · ${ { unset: '아직 정하지 않음', friend: '친구', crush: '호감', love: '사랑' }[feeling(npc)]}`);
    for (const [id, label] of [['friend', '친구'], ['crush', '호감'], ['love', '사랑']] as const) {
      const choice = button(feelings, label, () => session.setFeeling(npc.id, id) ? undefined : '지금은 마음을 바꿀 수 없어요');
      const update = () => {
        choice.classList.toggle('on', feeling(npc) === id);
        choice.setAttribute('aria-pressed', String(feeling(npc) === id));
      };
      updates.push(update);
      update();
    }
    const expression = make('hud-chips', body);
    const expressed = () => state.bonds.applied.includes(`feelings:${JSON.stringify([npc.id, now().day])}`);
    button(expression, '마음 표현', () => {
      const welcomed = incoming(npc).affection >= 40 && incoming(npc).comfort >= 20;
      return session.expressFeelings(npc.id) ? welcomed ? '반가워함' : '부담스러워함' : '오늘은 이미 마음을 표현했어요';
    }, expressed);
    live(make('hud-sub', expression, 'span'), () => expressed() ? '오늘 표현했어요' : '하루 1회');
    if (state.player.placeId === 'nest') button(expression, '차 마시자', () => {
      if (state.relationMode !== 'bonds') return '지금은 차를 초대할 수 없어요';
      if ((state.shop.residents.player?.atmosphere ?? 0) < 5) return '방 분위기가 5 이상이어야 해요';
      if (!friendly(incoming(npc))) return '상대와 먼저 친구가 되어야 해요';
      return session.inviteHomeTea(uid('home-tea'), npc.id) ? '함께 차를 마셨어요' : '상대가 지금 집에 없어요';
    });
    const topics = make('hud-chips', body);
    // Chatting happens face to face: the panel closes and the dialogue scene (src/ui/talk.ts) takes over.
    button(topics, '이야기하기', () => { show(''); location.talk(npc); });
    live(make('hud-sub', topics, 'span'), () => `${npc.likes.join(' · ')} 이야기를 좋아해요`);
    const gifts = make('hud-chips', body);
    make('hud-sub', gifts, 'span', owned().length ? '선물' : '선물할 물건이 없어요');
    for (const item of owned()) button(gifts, item.name, speak(npc, () => {
      const id = uid('gift'), { entry, line } = session.giveGift(id, npc.id, item.id);
      bond(id, entry);
      return line;
    }));
    const more = make('hud-chips', body);
    button(more, '소개팅 부탁 (30+)', () => { said = match(npc); },
      () => appointments().length > 0 || (state.relationMode === 'bonds' ? !friendly(incoming(npc)) : value(npc) < 30));
    live(make('hud-sub', more, 'span'), () => appointments().length ? '아직 끝나지 않은 약속이 있어요' : '친구가 되면 부탁할 수 있어요');
    button(more, '고백하기 (60+)', speak(npc, () => session.confess(uid('confess'), npc.id, { playerWantsDating: true,
      npcWantsDating: incoming(npc).affection >= 30 }).line), () => state.relationMode === 'bonds'
      ? !canStartDating(readBond(state.bonds, 'player', npc.id), incoming(npc),
        { playerWantsDating: true, npcWantsDating: incoming(npc).affection >= 30 }) : value(npc) < 60);
  }
  function people() {
    for (const date of appointments()) live(note(''), () => `약속 · ${date.impression.name} 님 · ${placeName(date.placeId)} ${clock(date.time)}`);
    const here = residents.filter(n => state.world.people[n.id]?.placeId === state.player.placeId);
    const npc = here.find(n => n.id === selected);
    if (npc) return person(npc);
    title(`${placeName(state.player.placeId)}에 있는 사람`);
    if (!here.length) note('지금은 아무도 없어요. 다른 장소로 가 보세요.');
    for (const n of here.sort((a, b) => Number('speech' in a) - Number('speech' in b) || value(b) - value(a))) {
      const line = row(`${n.name} · ${stage(n)}`, () => `${n.job} · ${scores(n)}`);
      live(line.querySelector('.hud-label')!.firstChild!, () => `${n.name} · ${stage(n)}`);
      line.classList.add('tap');
      line.onclick = () => act(() => { selected = n.id; speak(n, () => fun.recall(n.id) ?? session.buildDialogue(n.id).line)(); });
    }
  }
  function work(job: Job) {
    const result = session.startWork(job.id);
    if (!result.ok) return problems[result.error] ?? result.error;
    const { shift } = result;
    session.tick(job.durationMinutes / state.world.clock.minutesPerSecond); // working passes the shift's time
    return shift.paid ? `${job.durationMinutes / 60}시간 일하고 ${shift.wage}결 받았어요` : '일은 끝났지만 급여가 아직이에요';
  }
  function buy(b: Business, itemId: string) {
    const stock = b.store.stock.find(s => s.itemId === itemId)!, name = items.find(i => i.id === itemId)?.name ?? itemId;
    if (!stock.displayed) restock(b.store, itemId, 5);
    const visit = visitStore(b.store, state.world.ledger, uid('visit'), 'player', { itemId, maxPrice: stock.price }, 1, now());
    if (visit.status !== 'waiting') return problems[b.store.events.at(-1)?.reason ?? ''] ?? '살 수 없어요';
    const sale = checkoutBusiness(state.book, state.world.people, state.world.ledger, b.id, state.purses.player, visit.id, now());
    if (!sale.ok) return problems[sale.error] ?? '살 수 없어요';
    const life = state.shop.residents.player ??= { inventory: {}, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
    life.inventory[itemId] = (life.inventory[itemId] ?? 0) + 1;
    return `${name} 샀어요 (-${visit.price}결)`;
  }
  function chores() {
    title('아르바이트');
    for (const job of jobs) button(row(job.name, `${placeName(job.placeId)} · ${job.durationMinutes / 60}시간 · `
      + `${job.hourlyWage * job.durationMinutes / 60}결`), '일하기', () => work(job), state.player.placeId !== job.placeId);
    title(`${placeName(state.player.placeId)} 가게`);
    const shops = state.book.businesses.filter(b => b.placeId === state.player.placeId && b.closedAt === null);
    if (!shops.length) note('여기엔 가게가 없어요. 찻방·교환소·뜰에 가 보세요.');
    for (const b of shops) for (const s of b.store.stock) button(row(items.find(i => i.id === s.itemId)?.name ?? s.itemId,
      () => `${s.price}결 · 진열 ${s.displayed} · 창고 ${s.backroom}`), '사기', () => buy(b, s.itemId));
    title('가진 물건');
    if (!owned().length) note('아직 없어요.');
    for (const item of owned()) button(row(item.name, () => `${state.shop.residents.player!.inventory[item.id]}개`), '쓰기',
      () => `${item.name} 썼어요 · 활력 ${Math.round(useItem(state.shop, 'player', item.id).energy)}`);
    evening();
  }
  // 오늘 저녁 공연: a ticket (alone or treating an acquaintance), then a taste pick while at the venue during the show.
  function evening() {
    title('오늘 저녁 공연');
    for (const show of shows) {
      const host = npcs.find(n => n.id === show.hostId)!, mine = () => fun.today().filter(t => t.showId === show.id);
      live(row(show.name, '').querySelector('.hud-sub')!, () => ` ${placeName(show.placeId)} ${hm(show.start)}~${hm(show.end)} · ${show.price}결 · ${host.name}`
        + (mine().length ? ` · 표 ${mine().length}장${mine().filter(t => t.companionId).map(t => ` (${npcs.find(n => n.id === t.companionId)?.name})`).join('')}` : ''));
      const chosen = show.scenes.find(c => mine().some(t => t.sceneId === c.id));
      if (chosen) { note(`기억: ${chosen.memory}`); continue; }
      if (mine().some(t => t.status === 'attended') && state.player.placeId === show.placeId) {
        const chips = make('hud-chips', body);
        for (const scene of show.scenes) button(chips, scene.name, () => `${fun.choose(scene.id).name} · 활력 +15`);
        continue;
      }
      if (mine().some(t => t.status !== 'booked')) continue;
      const chips = make('hud-chips', body), friends = npcs.filter(n => n.id !== show.hostId && stage(n) !== '낯섦');
      button(chips, '혼자 표 사기', () => { fun.buyTicket(show.id); return `${show.name} 표를 샀어요 (-${show.price}결)`; });
      for (const n of friends) button(chips, `${n.name} 님과`, () => {
        fun.buyTicket(show.id, n.id); return `${n.name} 님과 함께 갈 표를 샀어요 (-${show.price * 2}결)`; });
    }
  }
  function stocks() {
    title('결증 (1주씩, 수수료 1%)');
    for (const c of companies) {
      const line = row(c.name, () => `${state.market.prices[c.id]}결 · ${state.market.holdings.player?.[c.id] ?? 0}주`);
      for (const side of ['buy', 'sell'] as const) button(line, side === 'buy' ? '사기' : '팔기', () => {
        const result = trade(state.market, state.world.ledger,
          { id: uid(side), time: now(), account: 'player', companyId: c.id, quantity: 1, side }, 'aro');
        return result.ok ? `${c.name} 1주 ${side === 'buy' ? '샀' : '팔았'}어요` : problems[result.error] ?? '거래할 수 없어요';
      }, () => side === 'sell' && !(state.market.holdings.player?.[c.id] ?? 0));
    }
    title('장소 이동');
    const list = make('hud-chips', body);
    for (const place of places) button(list, place.name, () => { go(place.id); return `${place.name} 도착`; },
      place.id === state.player.placeId);
  }
  // 메신저: core residents and anyone met, one thread each; replies arrive later through session.tick.
  const contacts = () => residents.filter(n => !('speech' in n) || readBond(state.bonds, n.id, 'player').met);
  const inbox = (npcId: string) => state.messenger.messages.filter(m => m.npcId === npcId && m.delivered);
  function thread(npc: Npc) {
    const head = make('hud-head', body), minute = () => Math.floor(state.world.clock.totalMinutes);
    button(head, '‹ 목록', () => { selected = ''; });
    live(make('hud-name', head), () => `${npc.name} · ${stage(npc)}`);
    if (!inbox(npc.id).length) note('아직 주고받은 메시지가 없어요.');
    for (const m of inbox(npc.id)) make(`hud-msg${m.from === 'player' ? ' me' : ''}`, body, 'div', m.text);
    live(make('hud-note hud-wait', body), () => !waiting(state.messenger, npc.id) ? ''
      : asleep(npc, minute()) ? `${npc.name} 님은 자고 있어요 · 아침에 답장할 거예요` : `${npc.name} 님이 답장을 쓰는 중…`);
    const chips = make('hud-chips', body), left = () => DAILY_LIMIT - sentToday(state.messenger, npc.id, minute());
    for (const [kind, label] of [['hello', '안부'], ['topic', `${npc.likes[0] ?? '요즘'} 이야기`], ['meet', '약속 잡기']] as const)
      button(chips, label, () => session.sendMessage(uid('msg'), npc.id, kind) ? undefined : '지금은 보낼 수 없어요',
        () => !!waiting(state.messenger, npc.id) || left() <= 0);
    live(make('hud-sub', chips, 'span'), () => left() > 0 ? `오늘 ${left()}번 더 보낼 수 있어요` : '오늘 연락은 여기까지예요');
  }
  function chat() {
    const npc = contacts().find(n => n.id === selected);
    if (npc) return thread(npc);
    title('메신저 · 떨어져 있어도 연락해요');
    for (const n of contacts()) {
      const line = row(`${n.name} · ${stage(n)}`, () => inbox(n.id).at(-1)?.text ?? '아직 대화가 없어요');
      line.classList.add('tap');
      line.onclick = () => act(() => { selected = n.id; });
    }
  }
  // C095/C095b: inside the player's own shop, customers' lines pop up as bubbles — as many at once as the crowd allows, stacked
  // so they never overlap — hagglers wait for an answer, a regular asks for 'the usual' and the first sale gets its moment.
  const patronBox = make('patrons'), crowdText = make('crowd', patronBox, 'span'), haggleBox = make('haggle', patronBox);
  const usualBox = make('haggle', patronBox), worryBox = make('haggle', patronBox), // C102: a regular's worry after buying → 업무 탭 제안
    bubbles = [0, 1, 2, 3].map(i => make(i % 2 ? 'bark alt' : 'bark', patronBox));
  const warm = make('first-sale'), mute = make('hud-open hud-mute', top, 'button');
  haggleBox.hidden = usualBox.hidden = worryBox.hidden = warm.hidden = mute.hidden = true;
  bubbles.forEach(b => { b.hidden = true; });
  mute.onclick = () => { setMuted(!isMuted()); render(); };
  let heard = state.world.clock.totalMinutes, asked = '', guessing = '', slowUntil = 0;
  const lines: string[] = [], sceneOf = () => session.tycoon.state().systems.scene as SceneState | undefined;
  const crowd = () => { const s = sceneOf(); return s ? crowdOf(s) : crowdLevels[0]; };
  const nextBark = () => bubbles.forEach((el, i) => {
    if (!el.hidden || i >= crowd().bubbles || !lines.length) return;
    el.textContent = lines.shift()!; el.hidden = false;
    window.setTimeout(() => { el.hidden = true; nextBark(); }, crowd().seconds * 1000);
  });
  function patronsUi() {
    const p = session.tycoon.state().systems.patrons as PatronState | undefined, sc = sceneOf(), lease = state.leases.find(l => !l.ended);
    const shop = state.book.businesses.find(b => b.id === lease?.businessId && b.closedAt === null);
    const inside = !!p && shop?.placeId === state.player.placeId;
    worryUi(session, worryBox, residents, inside, act, id => { selected = id; show('biz'); });
    // Regulars are known by name (C095b ⑥); everyone else by what kind of customer they look like.
    const who = (npcId: string, name: string) => sc?.regulars[npcId] ? `★ ${name}` : `${personas[p?.personas[npcId] ?? 'browser'].name} 손님`;
    const fresh = [...(p?.feed ?? []), ...(sc?.feed ?? [])].filter(l => l.minute > heard).sort((a, b) => a.minute - b.minute);
    if (inside) for (const l of fresh) if (!('kind' in l && l.kind === 'first')) lines.push(`${who(l.npcId, l.name)}: “${l.text}”`);
    if (inside && fresh.some(l => 'situation' in l && l.situation === 'purchased')) ding();
    if (inside && sc?.first && sc.first.minute > heard) { // C095b ⑤: once in the whole game, while it happens
      ding(true); slowUntil = performance.now() + 600; warm.hidden = false;
      warm.textContent = `첫 1결!\n${who(sc.first.npcId, residents.find(n => n.id === sc.first!.npcId)?.name ?? '')}: “${sceneLines.first}”`;
      window.setTimeout(() => { warm.hidden = true; }, 2500);
    }
    heard = Math.max(heard, ...fresh.map(l => l.minute));
    nextBark();
    crowdText.hidden = mute.hidden = !inside;
    crowdText.textContent = `${crowd().name} · 손님 ${sc?.present.length ?? 0}명`;
    mute.textContent = isMuted() ? '🔇' : '🔔';
    const u = inside ? sc?.asks[0] : undefined;
    usualBox.hidden = !u;
    if (u && guessing !== u.npcId) {
      guessing = u.npcId; usualBox.replaceChildren();
      make('', usualBox, 'div', `${who(u.npcId, residents.find(n => n.id === u.npcId)?.name ?? u.npcId)}: “${sceneLines.usual}”`);
      const btns = make('haggle-btns', usualBox);
      for (const st of shop!.store.stock) button(btns, items.find(i => i.id === st.itemId)?.name ?? st.itemId, () => {
        guessing = ''; session.tycoon.command('scene', (c, s: SceneState) => guessUsual(c, s, u.npcId, st.itemId));
      });
    }
    const h = inside ? p!.haggles[0] : undefined;
    haggleBox.hidden = !h;
    if (!h || asked === h.visitId) return;
    asked = h.visitId; haggleBox.replaceChildren();
    const name = residents.find(n => n.id === h.npcId)?.name ?? h.npcId, list = shop!.store.stock.find(s => s.itemId === h.itemId)?.price ?? 0;
    const said = [...p!.feed].reverse().find(l => l.npcId === h.npcId && l.situation === 'haggle')?.text ?? '조금 깎아 주세요.';
    make('', haggleBox, 'div', `${name}: “${said}”\n${items.find(i => i.id === h.itemId)?.name ?? h.itemId} ${list}결 → ${h.offer}결`);
    const reply = (accept: boolean) => () => { asked = ''; return session.tycoon.command('patrons', (c, s: PatronState) =>
      answerHaggle(c, s, h.visitId, accept)) && accept ? `${h.offer}결에 팔았어요` : accept ? '팔지 못했어요' : `${name} 님이 그냥 갔어요`; };
    button(make('haggle-btns', haggleBox), '깎아 주기', reply(true)); button(haggleBox.lastElementChild as HTMLElement, '안 돼요', reply(false));
  }
  // C100: one card per roadworks stage — when, what it does to parking, one person's line and up to three answers (GDD 원칙 6).
  const cityBox = make('haggle', patronBox);
  let cityShown = '';
  function cityUi() {
    const c = session.tycoon.state().systems.cityEvents as CityState | undefined, e = c && currentEvent(c);
    const minute = Math.floor(state.world.clock.totalMinutes), key = e ? JSON.stringify([e.id, e.stage, e.seen, e.impact]) : '';
    cityBox.hidden = !e;
    if (!e || key === cityShown) return;
    cityShown = key; cityBox.replaceChildren();
    const shop = state.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null);
    const answer = (kind: 'breakfast' | 'parking' | 'none', itemId?: string) => () => session.tycoon.command('cityEvents',
      (ctx, s: CityState) => respond(ctx, s, kind, itemId)) ? { breakfast: '아침 메뉴를 내걸었어요', parking: '주차장과 제휴했어요', none: '그대로 영업해요' }[kind] : '지금은 할 수 없어요';
    if (e.stage === 'ended') {
      make('', cityBox, 'div', `${cityLines.reopened} 앞 주차 ${parkingSpaces}칸`);
      button(make('haggle-btns', cityBox), '확인', () => { session.tycoon.command('cityEvents', readNotice); });
      return;
    }
    const days = Math.ceil((e.startAt - minute) / 1440), worker = residents.find(n => n.id === e.workers[0])?.name ?? '인부';
    make('', cityBox, 'div', e.stage === 'announced'
      ? `${['오늘', '내일', '모레'][days] ?? `${days}일 뒤`} 07:00부터 ${roadworks.days}일 · 앞 주차 ${parkingSpaces}→0칸 · 도보 출입 가능\n${worker}: “${cityLines.rumor}”`
      : `앞길 공사 중 · ${Math.ceil((e.endAt - minute) / 1440)}일 남음\n차 손님 못 옴 ${e.impact.carFails} · 인부 구매 ${e.impact.workerBuys}`);
    make('', make('', cityBox, 'details'), 'summary', '왜 공사하나요').after(cityLines.why);
    const btns = make('haggle-btns', cityBox), food = shop?.store.stock.find(st => items.find(i => i.id === st.itemId)?.category === 'food');
    if (food) button(btns, '아침 메뉴', answer('breakfast', food.itemId));
    if (!e.responses.some(r => r.kind === 'parking')) button(btns, `주차 제휴 ${partnerLot.perDay * Math.ceil((e.endAt - Math.max(minute, e.startAt)) / 1440)}결`, answer('parking'));
    button(btns, '그대로 영업', answer('none'));
  }
  // Numbers update in place; only actions and changes to the visible list rebuild the panel.
  function render(force = false) {
    patronsUi(); cityUi();
    const cash = state.world.ledger.balances.player ?? 0, energy = state.shop.residents.player?.energy ?? 50;
    timeText.textContent = clock(now());
    placeText.textContent = placeName(state.player.placeId);
    cashText.textContent = `${cash}결`;
    energyText.textContent = `활력 ${Math.round(energy)}`;
    const shop = shopStatus(state);
    weatherText.textContent = shop.icon;
    weatherText.title = shop.name;
    warnText.textContent = shop.warning;
    loadText.textContent = shop.load ? `📦×${shop.load}` : ''; // C096: boxes carried by hand
    fun.sync();
    pending ||= force;
    if (panel.hidden) return;
    const membership = tab === 'people'
      ? [residents.filter(n => state.world.people[n.id]?.placeId === state.player.placeId).map(n => n.id),
        appointments().map(a => [a.id, a.status]),
        selected ? owned().map(i => i.id) : []]
      : tab === 'work'
        ? [state.book.businesses.filter(b => b.placeId === state.player.placeId && b.closedAt === null)
          .map(b => [b.id, b.store.stock.map(s => s.itemId)]), owned().map(i => i.id),
          fun.today().map(t => [t.status, t.sceneId])]
        : tab === 'chat' ? [contacts().map(n => n.id), state.messenger.messages.filter(m => m.delivered).length]
        : tab === 'shop' ? shopKey(state)
        : tab === 'biz' ? workKey(session)
        : [companies.map(c => c.id), Object.keys(state.market.holdings.player ?? {})
          .filter(id => state.market.holdings.player[id] > 0).sort()];
    const key = JSON.stringify([tab, state.player.placeId, selected, membership]);
    if (pointers.size || !pending && key === shown) {
      updates.forEach(update => update());
      return;
    }
    pending = false;
    shown = key;
    const scroll = body.scrollTop;
    updates = [];
    body.replaceChildren();
    Array.from(tabBar.children).forEach((element, index) => element.classList.toggle('on', Object.keys(tabs)[index] === tab));
    body.classList.toggle('shop', tab === 'shop');
    ({ people, work: chores, stock: stocks, chat, shop: () => shopTab(session, { body, residents, make, button, row, title, note, live,
      contacts, stage, placeName, hiring: selected === 'hire', hire: on => { selected = on ? 'hire' : ''; } }),
      biz: () => workTab(session, { body, residents, make, button, row, title, note, act, selected, select: id => { selected = id; } }) })[tab]();
    body.scrollTop = tab === 'chat' && selected ? body.scrollHeight : scroll;
  }
  render();
  setInterval(render, 1000);
  return { stick, knob, say, ready: () => document.getElementById('loading')?.remove(),
    // The clock stops while the player reads the 결폰 or the skip question; main shows 멈춤 for those and dialogue.
    reading: () => !panel.hidden || !ask.hidden || performance.now() < slowUntil, paused(on: boolean) { pause.hidden = !on; },
    // ?phone=<tab>[,<placeId>] opens the panel (screenshots); door() gets the nearest door, or nothing.
    open(next: string, placeId?: string) {
      if (placeId && places.some(p => p.id === placeId)) act(() => go(placeId));
      if (next in tabs) show(next as Tab);
    },
    door(next?: Door) {
      if (next === nearDoor) return;
      nearDoor = next;
      if (nearDoor) enter.textContent = `${placeName(nearDoor.placeId)} 들어가기`;
      enter.hidden = !nearDoor || !panel.hidden;
    } };
}
