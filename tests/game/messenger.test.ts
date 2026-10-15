import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { edgeKey, emptyBond, readBond } from '../../src/sim/bonds';
import { DAILY_LIMIT } from '../../src/sim/messenger';
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const befriend = (session: ReturnType<typeof createSession>, npcId: string) => {
  session.state.bonds.edges[edgeKey(npcId, 'player')] = { ...emptyBond(), affection: 40, trust: 25, comfort: 20, met: true };
};
const reply = (session: ReturnType<typeof createSession>, npcId: string) =>
  session.state.messenger.messages.filter(m => m.npcId === npcId && m.from === 'npc').at(-1)!;
it('C076: a sleeping resident answers next morning; tone and speed follow the relationship stage', () => {
  const session = createSession(memory(), 123);
  befriend(session, 'nuel'); // nuel sleeps at the 공동집 at midnight; aro is a stranger
  expect(session.sendMessage('m1', 'nuel', 'hello')).toBe(true);
  expect(session.sendMessage('m2', 'nuel', 'hello')).toBe(false); // one message at a time
  session.tick(7 * 60 + 5);
  expect(reply(session, 'nuel').delivered).toBe(false);
  session.tick(10);
  expect(reply(session, 'nuel').text).toBe('응, 잘 지내! 너는?');
  expect(readBond(session.state.bonds, 'nuel', 'player').comfort).toBe(22);
  expect(session.sendMessage('m3', 'aro', 'hello')).toBe(true); // 07:15, aro is awake and a stranger: slow, formal
  session.tick(170);
  expect(reply(session, 'aro').delivered).toBe(false);
  session.tick(10);
  expect(reply(session, 'aro').text).toBe('네, 안녕하세요. 연락 주셔서 감사합니다.');
});
it('C076: a friend\'s yes becomes a scheduled appointment; strangers decline; daily limit; save keeps threads', () => {
  const storage = memory(), session = createSession(storage, 123);
  session.tick(8 * 60);
  befriend(session, 'nuel');
  session.sendMessage('meet-aro', 'aro', 'meet'); session.sendMessage('meet-nuel', 'nuel', 'meet');
  session.tick(180);
  expect(reply(session, 'aro').text).toBe('죄송하지만 아직은 만나기 어렵습니다.');
  const [date] = session.state.matchmaking.appointments;
  expect(session.state.matchmaking.appointments).toHaveLength(1);
  expect(date).toMatchObject({ npcId: 'nuel', status: 'scheduled' });
  expect(reply(session, 'nuel').text).toBe(`좋아! 오늘 ${date.time.hour}시에 잔물결 찻방에서 봐.`);
  for (let i = 1; i < DAILY_LIMIT; i++) { expect(session.sendMessage(`more:${i}`, 'nuel', 'topic')).toBe(true); session.tick(15); }
  expect(session.sendMessage('over', 'nuel', 'hello')).toBe(false);
  session.saveNow();
  expect(createSession(storage).state.messenger.messages).toHaveLength(session.state.messenger.messages.length);
  const old = JSON.parse(storage.getItem(SESSION_KEY)!); delete old.state.messenger;
  storage.setItem(SESSION_KEY, JSON.stringify(old));
  const restored = createSession(storage);
  expect(restored.loadResult.ok).toBe(true); expect(restored.state.messenger.messages).toEqual([]);
});
