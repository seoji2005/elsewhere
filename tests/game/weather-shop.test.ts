import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import { items } from '../../src/data/items';
import { gameTime } from '../../src/sim/clock';
import { checkout, restock, setPrice, visitStore } from '../../src/sim/store';
import { chooseWeatherNeed, weatherFor, type Weather } from '../../src/sim/weather';
function memory(): Storage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const tea = items.filter(item => item.id === 'tea'), anyone = { likes: [], priceTolerance: 1.2, patienceMinutes: 1 };
const dayWith = (seed: number, weather: Weather) => {
  for (let day = 1; day < 100; day++) if (weatherFor(seed, day) === weather) return day;
  throw Error(`No ${weather} day`);
};
it('C073: same seed, a rainy day raises tea maxPrice above a sunny day', () => {
  const seed = 123, rain = dayWith(seed, 'rain'), sunny = dayWith(seed, 'sunny');
  expect(weatherFor(seed, rain)).toBe(weatherFor(seed, rain)); // Deterministic per seed and day.
  const wet = chooseWeatherNeed(anyone, tea, 0.5, rain, weatherFor(seed, rain))!;
  const dry = chooseWeatherNeed(anyone, tea, 0.5, sunny, weatherFor(seed, sunny))!;
  expect(wet.itemId).toBe('tea'); expect(wet.maxPrice).toBeGreaterThan(dry.maxPrice);
});
it('C073: the weekday trend makes its item wanted more often', () => {
  const count = (day: number) => Array.from({ length: 900 }, (_, i) =>
    chooseWeatherNeed(anyone, items, i / 900, day, 'cloudy')!.itemId).filter(id => id === 'tea').length;
  expect(count(1)).toBeGreaterThan(count(2)); // Day one (Monday) trends tea; day two trends bread.
});
it('C073: overpriced and sold-out complaints lower reputation; fair prices recover it slowly', () => {
  const session = createSession(memory(), 123), { state } = session, { ledger } = state.world;
  const endDay = () => session.tick((1440 - state.world.clock.totalMinutes % 1440) / state.world.clock.minutesPerSecond);
  const day = gameTime(state.world.clock).day;
  setPrice(state.store, 'tea', 100);
  visitStore(state.store, ledger, `pricey:${day}`, 'lise', { itemId: 'tea', maxPrice: 9 }, 1, gameTime(state.world.clock));
  visitStore(state.store, ledger, `empty:${day}`, 'lise', { itemId: 'bread', maxPrice: 12 }, 1, gameTime(state.world.clock));
  endDay();
  const low = state.reputation.player;
  expect(low).toBe(-4);
  setPrice(state.store, 'tea', 8);
  for (let i = 0; i < 2; i++) {
    const now = gameTime(state.world.clock); restock(state.store, 'tea', 1);
    visitStore(state.store, ledger, `fair:${now.day}`, 'lise', { itemId: 'tea', maxPrice: 9 }, 1, now);
    expect(checkout(state.store, ledger, `fair:${now.day}`, now).ok).toBe(true);
    endDay();
  }
  expect(state.reputation.player).toBe(low + 2); // One point per fair day: slower than a complaint costs.
});
it('C073: an old save without reputation loads with the default', () => {
  const storage = memory(), session = createSession(storage, 123); session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); delete saved.state.reputation;
  storage.setItem(SESSION_KEY, JSON.stringify(saved));
  expect(createSession(storage).state.reputation).toEqual({ player: 0 });
});
