import type { Item } from '../data/items';
import { chooseNeed, type Customer, type Need } from './customer';

export type Weather = 'sunny' | 'cloudy' | 'rain';
export function weatherFor(seed: number, day: number): Weather {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isSafeInteger(day) || day < 1) throw Error('Invalid weather seed or day');
  let hash = seed;
  for (const c of `weather:${day}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return (['sunny', 'cloudy', 'rain'] as const)[hash % 3];
}

// Day one is Monday. A rotating daily trend weights product selection.
const trends = ['tea', 'bread', 'soup', 'scarf', 'coat', 'lamp', 'chime'];
export const demandWeight = (itemId: string, day: number) => itemId === trends[(day - 1) % 7] ? 2 : 1;
export function chooseWeatherNeed(customer: Customer, catalog: readonly Item[], sample: number,
  day: number, weather: Weather): Need | undefined {
  if (!Number.isSafeInteger(day) || day < 1 || !['sunny', 'cloudy', 'rain'].includes(weather))
    throw Error('Invalid demand context');
  // Retain the base customer's validation and preference rules.
  chooseNeed(customer, catalog, sample);
  const preferred = catalog.filter(item => customer.likes.includes(item.topic));
  const choices = preferred.length ? preferred : catalog;
  const weight = (item: Item) => demandWeight(item.id, day);
  let cursor = sample * choices.reduce((sum, item) => sum + weight(item), 0);
  const item = choices.find(item => (cursor -= weight(item)) < 0);
  if (!item) return undefined;
  const warm = weather === 'rain' && ['tea', 'soup'].includes(item.id);
  return chooseNeed(customer, [{ ...item, price: warm ? Math.ceil(item.price * 1.25) : item.price }], 0);
}
