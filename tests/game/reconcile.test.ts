import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { applyBondEvent, edgeKey, emptyBond, readBond } from '../../src/sim/bonds';
const time = { day: 1, hour: 0, minute: 0 }, key = edgeKey('lise', 'player');
function setup() {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); } };
  const session = createSession(storage, 123);
  session.state.player.placeId = 'quiet';
  session.state.bonds.edges[key] = { ...emptyBond(), met: true, affection: 40, trust: 25, comfort: 20 };
  return { session, storage };
}
it('no-show stays awkward across saves; one apology restores deeper trust and comfort once', () => {
  const { session, storage } = setup(), { state } = session;
  state.matchmaking.appointments.push({ id: 'date', actorId: 'player', introducerId: 'aro', npcId: 'lise',
    placeId: 'office', time: { day: 1, hour: 6, minute: 0 }, status: 'scheduled', noShowBy: [],
    impression: { name: '리세', appearance: {}, keywords: [], note: '' }, playerInterest: 2, npcInterest: 2 });
  session.tick(420); expect(state.matchmaking.appointments[0].status).toBe('no-show');
  expect(readBond(state.bonds, 'lise', 'player').trust).toBe(15);
  state.player.placeId = 'office'; session.saveNow(); const next = createSession(storage);
  expect(next.loadResult.ok).toBe(true); expect(next.buildDialogue('lise').line).toContain('서먹');
  const reverse = readBond(next.state.bonds, 'player', 'lise');
  expect(next.apologize('lise')).toMatchObject({ accepted: true, line: expect.stringContaining('전보다 더 믿고') });
  expect(readBond(next.state.bonds, 'lise', 'player')).toMatchObject({ trust: 26, comfort: 21 });
  expect(readBond(next.state.bonds, 'player', 'lise')).toEqual(reverse);
  next.saveNow(); const loaded = createSession(storage), before = structuredClone(loaded.state);
  expect(loaded.apologize('lise').accepted).toBe(false); expect(loaded.state).toEqual(before);
  applyBondEvent(loaded.state.bonds, 'another-mistake', time, [{ fromId: 'lise', toId: 'player', delta: { comfort: -3 } }]);
  expect(loaded.apologize('lise').accepted).toBe(true);
});
it('disliked gifts and mistakes create conflict; only a tailored gift reconciles and consumes stock', () => {
  const { session } = setup(), { state } = session;
  state.shop.residents.player = { inventory: { speaker: 1, chime: 1, bread: 2 }, energy: 50,
    appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  session.giveGift('bad', 'lise', 'speaker'); expect(session.buildDialogue('lise').line).toContain('서먹');
  session.giveGift('neutral', 'lise', 'chime'); expect(state.bonds.edges[key].hurt?.resolved).toBe(false);
  expect(session.giveGift('tailored', 'lise', 'bread').line).toContain('전보다 더 믿고');
  expect(state.bonds.edges[key]).toMatchObject({ trust: 26, hurt: { resolved: true } });
  expect(state.bonds.edges[key].comfort).toBeGreaterThan(20);
  expect(state.shop.residents.player.inventory).toMatchObject({ speaker: 0, chime: 0, bread: 1 });
  const trust = state.bonds.edges[key].trust; session.giveGift('again', 'lise', 'bread');
  expect(state.bonds.edges[key].trust).toBe(trust); expect(session.apologize('lise').accepted).toBe(false);
});
it('does nothing without an incident or in legacy mode, rejects absence, and accepts old saves', () => {
  const { session, storage } = setup(), before = structuredClone(session.state);
  expect(session.apologize('lise').accepted).toBe(false); expect(session.state).toEqual(before);
  session.saveNow(); expect(createSession(storage).loadResult.ok).toBe(true);
  session.state.player.placeId = 'nest'; expect(() => session.apologize('lise')).toThrow('지금 여기 없어요');
  session.state.player.placeId = 'quiet'; session.state.relationMode = 'legacy';
  expect(session.apologize('lise').accepted).toBe(false);
});
it('mistakes preserve the original baseline; exhausted daily bonus budget waits until tomorrow', () => {
  const { session } = setup(), bonds = session.state.bonds;
  session.talk('mistake', 'lise', { id: 'bad-topic', topic: '낭비', tone: 'social' });
  expect(session.buildDialogue('lise').line).toContain('서먹');
  applyBondEvent(bonds, 'spent', time, [{ fromId: 'lise', toId: 'player', delta: { affection: 10 } }]);
  applyBondEvent(bonds, 'hurt-again', time, [{ fromId: 'lise', toId: 'player', delta: { trust: -10 } }]);
  const before = structuredClone(bonds); expect(session.apologize('lise').accepted).toBe(false); expect(bonds).toEqual(before);
  session.tick(1440); expect(session.apologize('lise').accepted).toBe(true);
  expect(bonds.edges[key]).toMatchObject({ trust: 26, comfort: 21 });
  expect(Object.values(bonds.gained).every(gain => gain <= 10)).toBe(true);
});
