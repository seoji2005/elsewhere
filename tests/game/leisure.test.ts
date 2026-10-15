import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import { leisure, type LeisureState } from '../../src/game/tycoon/leisure';
import { applyBondEvent, readBond } from '../../src/sim/bonds';
import { gameTime } from '../../src/sim/clock';

function memory(): Storage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const total = (balances: Record<string, number>) => Object.values(balances).reduce((sum, n) => sum + n, 0);
function setup(storage = memory()) {
  const session = createSession(storage, 11), { state } = session;
  applyBondEvent(state.bonds, 'met-aro', gameTime(state.world.clock), [{ fromId: 'aro', toId: 'player', delta: {}, met: true }]);
  const until = (minute: number) => session.tick((minute - state.world.clock.totalMinutes) / state.world.clock.minutesPerSecond);
  return { session, state, until, show: leisure(session), energy: () => state.shop.residents.player?.energy ?? 50 };
}

it('C105: a ticket moves the fee to the host, conserves money and needs an acquaintance to invite', () => {
  const { state, show } = setup(), before = { ...state.world.ledger.balances };
  expect(() => show.buyTicket('jazz', 'velo')).toThrow('Not acquainted');
  show.buyTicket('jazz', 'aro');
  expect(state.world.ledger.balances.player).toBe(before.player - 50);
  expect(state.world.ledger.balances.nuel).toBe(before.nuel + 50);
  expect(total(state.world.ledger.balances)).toBe(total(before));
});

it('C105: only attending gives the memory and energy, once per show however many tickets', () => {
  const { state, until, show, energy } = setup();
  show.buyTicket('jazz', 'aro'); show.buyTicket('jazz', 'aro');
  expect(() => show.choose('jazz-ballad')).toThrow('Not attending');
  state.player.placeId = 'cafe'; until(19 * 60 + 5);
  state.shop.residents.player = { ...state.shop.residents.player!, energy: 40 };
  expect(show.choose('jazz-ballad').memory).toContain('색소폰');
  expect(() => show.choose('jazz-swing')).toThrow('Already chosen');
  expect(energy()).toBe(55);
  expect(state.dialogue.memories.aro.entries.filter(m => m.sourceEventId === 'leisure:jazz:1')).toHaveLength(1);
  expect(show.recall('aro')).toBeUndefined(); // not on the same day
  until(1440 + 10 * 60);
  expect(show.recall('aro')).toContain('색소폰');
  expect(show.recall('aro')).toBeUndefined();
});

it('C105: a no-show keeps the fee, lowers the companion\'s trust and leaves no memory', () => {
  const { state, until, show, energy } = setup(), twin = setup();
  show.buyTicket('acoustic', 'aro'); const paid = state.world.ledger.balances.player;
  until(21 * 60 + 1); show.sync(); twin.until(21 * 60 + 1);
  expect(show.today().map(t => t.status)).toEqual(['closed']);
  expect(readBond(state.bonds, 'aro', 'player').trust).toBeLessThan(0);
  expect(state.world.ledger.balances.player).toBeLessThanOrEqual(paid);
  expect(state.dialogue.memories.aro?.entries ?? []).toHaveLength(0);
  expect(energy()).toBe(twin.energy());
});

it('C105: tickets and choices survive save and restore', () => {
  const storage = memory(), { session, state, until, show } = setup(storage);
  show.buyTicket('comedy'); state.player.placeId = 'shop'; until(20 * 60 + 5); show.choose('comedy-crowd');
  session.saveNow();
  const next = createSession(storage);
  expect(next.loadResult.ok).toBe(true);
  expect(next.tycoon.state().systems.leisure).toEqual(session.tycoon.state().systems.leisure);
  expect((next.tycoon.state().systems.leisure as LeisureState).tickets[0]).toMatchObject({ status: 'attended', sceneId: 'comedy-crowd' });
  expect(() => leisure(next).choose('comedy-work')).toThrow('Already chosen');
});
