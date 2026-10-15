// C078: features.json owner=auto 항목별 통과 기준 확인. 이미 다른 테스트가 확인하는 항목은 그 테스트 이름을 적는다.
// 구현이 없어 확인할 수 없는 항목(M2-02, M2-05, M2-06, M2-07, M2-08)은 테스트를 두지 않고 보고에 적는다.
import { describe, expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import { npcs } from '../../src/data/npcs';
import { companies } from '../../src/data/companies';
import { gameTime } from '../../src/sim/clock';
import { whereIs } from '../../src/sim/npc';
import { generate } from '../../src/sim/npcgen';
import { trade } from '../../src/sim/market';
import { edgeKey, emptyBond, readBond } from '../../src/sim/bonds';

function memory(): Storage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
// Advance a session to the given clock minute of the current or next day.
function at(session: ReturnType<typeof createSession>, day: number, hour: number) {
  session.tick((day - 1) * 1440 + hour * 60 - session.state.world.clock.totalMinutes);
}

// M1-01 폰 가로 스크린샷 2안: 시각 판단. tools/shot.mjs --smoke(자동 검사)가 오류 없는 촬영만 확인한다.
// M1-10 집→가게→공원 조이스틱 이동: 브라우저 전용. 문은 cafe·shop 두 곳뿐(src/data/doors.ts) → 보고의 "실패".

describe('M1-11 이름 있는 NPC 5명, 각자 하루 일과', () => {
  // 기존: tests/sim/npc.test.ts 'has six complete residents ...', 'locates every resident differently in morning and evening'
  it('같은 세션에서 아침과 저녁에 이름 있는 주민 5명 이상이 서로 다른 장소에 있다', () => {
    const session = createSession(memory(), 123), { people } = session.state.world;
    at(session, 1, 9); const morning = Object.fromEntries(npcs.map(n => [n.id, people[n.id].placeId]));
    at(session, 1, 19); const evening = Object.fromEntries(npcs.map(n => [n.id, people[n.id].placeId]));
    expect(npcs.length).toBeGreaterThanOrEqual(5);
    expect(npcs.filter(n => morning[n.id] !== evening[n.id]).length).toBeGreaterThanOrEqual(5);
  });
});

describe('M1-12 대화 선택지로 관계 단계가 오른다', () => {
  // 기존: session.test 'applies ten chats and a gift once ...'(낯섦 → 아는 사이),
  // 'C051: seed 123 reaches mutual dating within 20 days ...'(친구·호감·연인 첫 단계)
  it('처음 만난 주민에게 대화 선택지 하나를 고르면 낯섦에서 아는 사이로 오른다', () => {
    const session = createSession(memory(), 123);
    session.state.player.placeId = 'quiet';
    expect(session.stageFor('lise')).toBe('낯섦');
    session.talk('feature:chat', 'lise', session.buildDialogue('lise').choices[0]);
    expect(session.stageFor('lise')).toBe('아는 사이');
  });
});

describe('M1-13 10분 안에 첫 수입', () => {
  // 기존: tests/sim/work.test.ts 'earns the first wage from midnight within one real minute ...', tests/play/loop.mjs(일하기 → 결 +30)
  it('새 게임에서 찻방 일을 시작하면 실제 60초 만에 지갑이 늘어난다', () => {
    const session = createSession(memory(), 123), { balances } = session.state.world.ledger;
    const before = balances.player;
    session.state.player.placeId = 'cafe';
    expect(session.startWork('tea-helper').ok).toBe(true);
    for (let second = 0; second < 60; second++) session.tick(1);
    // C114: 찻방 시급 30→2결. 금액이 아니라 첫 수입이 생겼는지(증가)를 본다.
    expect(balances.player).toBeGreaterThan(before);
  });
});

// M1-14 번 돈으로 산 것이 화면이나 관계에 반영
//   기존: tests/sim/shop.test.ts 'applies food, clothing and decoration effects only to owned items',
//   'spends the first wage on a gift and changes the existing world relationship by taste',
//   tests/sim/encounter.test.ts 'uses worn clothing rather than inventory ...', tests/play/social.mjs(차 사서 마시면 활력 증가)

describe('M1-15 회사 3개 주식, 사건 후 주가 변동과 매매', () => {
  // 기존: tests/sim/market.test.ts 'applies signed events ...', 'settles buys and sells ...',
  // session.test 'settles all three listed shops once using their actual revenue ...', tests/play/loop.mjs(1주 매수)
  it('상장사 3곳이 주민 가게와 이어져 있고, 세션 지갑으로 사고팔 수 있다', () => {
    const session = createSession(memory(), 123), { state } = session;
    expect(companies).toHaveLength(3);
    for (const c of companies) expect(state.book.businesses.some(b => b.ownerId === c.npcId)).toBe(true);
    const order = (side: 'buy' | 'sell') => ({ id: `feature:${side}`, time: gameTime(state.world.clock),
      account: 'player', companyId: 'tea', quantity: 1, side });
    const cash = state.world.ledger.balances.player;
    expect(trade(state.market, state.world.ledger, order('buy'), 'aro').ok).toBe(true);
    expect(state.market.holdings.player.tea).toBe(1);
    expect(trade(state.market, state.world.ledger, order('sell'), 'aro').ok).toBe(true);
    expect(state.market.holdings.player.tea).toBe(0);
    expect(state.world.ledger.balances.player).toBeLessThan(cash); // 수수료만 빠진다
  });
});

describe('M1-16 자동 저장·이어 하기', () => {
  // 기존: session.test 'saves the full session including position and continues after reopening',
  // 'advances each skipped day and saves by game time, on day changes and explicitly', tests/play/loop.mjs(새로고침 뒤 복원)
  it('저장 버튼 없이 시간만 흐른 뒤 다시 열어도 같은 시각·지갑으로 이어진다', () => {
    const storage = memory(), session = createSession(storage, 123);
    session.state.player.placeId = 'cafe'; session.startWork('tea-helper');
    for (let second = 0; second < 90; second++) session.tick(1); // 자동 저장 주기(60분) 이상
    const next = createSession(storage);
    expect(next.loadResult.ok).toBe(true);
    expect(next.state.world.clock.totalMinutes).toBeGreaterThanOrEqual(60);
    expect(next.state.world.ledger.balances.player).toBe(session.state.world.ledger.balances.player);
  });
});

describe('M1-17 NPC 생성기 50명 이상', () => {
  // 기존: tests/sim/npcgen.test.ts 'is deterministic, independent of other calls and different across seeds',
  // 'creates unique fictional names, usable NPC profiles and varied appearance', 'defines distinct archetypes ...'
  it('새 게임 두 개가 각각 서로 다른 50명 이상의 주민을 일과대로 배치한다', () => {
    const a = createSession(memory(), 1), b = createSession(memory(), 2);
    const generated = (s: ReturnType<typeof createSession>) =>
      Object.values(s.state.world.people).filter(p => p.id.startsWith('generated-'));
    expect(generated(a).length).toBeGreaterThanOrEqual(50);
    expect(new Set(generated(a).map(p => p.name)).size).toBe(generated(a).length);
    expect(generated(a).map(p => p.name)).not.toEqual(generated(b).map(p => p.name));
    expect(new Set(generated(a).map(p => p.placeId)).size).toBeGreaterThan(1);
  });
});

// M1-18 우연한 만남과 소개팅
//   기존: tests/sim/encounter.test.ts 'finds first meetings at the current place/time ...',
//   tests/sim/matchmaking.test.ts 'a friend introduces a compatible acquaintance ...',
//   session.test 'C050: arrival %s, tick %s records both bonds without no-shows'(세션에서 소개팅 성사)

describe('M1-20 함께한 일을 며칠 뒤 NPC가 먼저 언급', () => {
  // 기존: tests/sim/dialogue.test.ts 'remembers a capped gift later ...', 'initiates %s recall after a day ...'
  it('세션에서 함께 가게 일을 한 친한 주민이 며칠 안에 단둘일 때 그 장소를 먼저 꺼낸다', () => {
    const session = createSession(memory(), 123), { state } = session;
    at(session, 1, 7); state.player.placeId = 'cafe';
    expect(session.startWork('tea-helper').ok).toBe(true);
    session.tick(60);
    expect(state.dialogue.memories.nuel.entries.some(m => m.kind === 'shared-work')).toBe(true);
    // 회상은 단둘·친한 사이에서만 나온다(dialogue.ts informalFor).
    state.bonds.edges[edgeKey('nuel', 'player')] = { ...readBond(state.bonds, 'nuel', 'player'),
      affection: 40, trust: 25, comfort: 20 };
    for (let hour = 8; hour < 72; hour++) {
      session.tick(60);
      const time = gameTime(state.world.clock), place = whereIs(npcs.find(n => n.id === 'nuel')!, time);
      const alone = [...npcs, ...generate(123, 50)].every(n => n.id === 'nuel' || whereIs(n, time) !== place);
      if (time.day < 2 || !alone) continue;
      state.player.placeId = place;
      const line = session.buildDialogue('nuel').line;
      if (line.includes('잔물결 찻방')) return;
    }
    expect.unreachable('사흘 안에 단둘인 때 회상 대사가 없다');
  });
});

// M1-21 생성 주민 대화·선물·소개팅·고백과 말투 전환
//   기존: session.test 'connects generated dialogue, gifts, dating, introductions and public notices ...',
//   tests/game/dialogue-privacy.test.ts 'keeps generated NPC informal thresholds in private ...'

// M1-22 공·사 반전 말투
//   기존: tests/game/dialogue-privacy.test.ts 'changes public/private greeting and response for $id'(조율실 여럿 vs 밤 공원 단둘)

// M2-01 연인이 되면 주변 주민이 반응
//   기존: tests/sim/ripple.test.ts 'expires from the original event at 14 days and lets two residents mention public dating',
//   session.test 'connects generated dialogue, ...'(관찰자가 '저도 봤어요')

// M2-03 주선자 말투 메모와 노쇼 신뢰 하락
//   기존: tests/sim/matchmaking.test.ts 'adds clothing to NPC interest and uses the introducer speech for the note',
//   session.test 'C055: no-show applies once; skipped=%s, player present=%s'(주선자 trust -5)

describe('M2-04 의상 첫인상 보너스와 집 초대', () => {
  // 기존: tests/sim/encounter.test.ts 'uses worn clothing rather than inventory for directional encounter interest',
  // 'opens a planned home tea meal only with decoration and friendship, then records completion',
  // tests/sim/matchmaking.test.ts 'adds clothing to NPC interest ...', session.test 'C051: feelings, tea attendance, ...'
  it('방 장식 없이는 친한 주민도 집 차 초대가 열리지 않는다', () => {
    const session = createSession(memory(), 123), id = 'generated-123-0';
    session.state.bonds.edges[edgeKey(id, 'player')] = { ...emptyBond(), affection: 40, trust: 25, comfort: 20, met: true };
    expect(session.inviteHomeTea('feature:tea', id)).toBe(false);
  });
});
