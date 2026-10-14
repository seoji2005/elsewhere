import type { Item } from '../data/items';

export interface Need { itemId: string; maxPrice: number }
export interface Customer {
  likes: readonly string[];
  priceTolerance: number; // Multiplier of catalog price: 1 accepts the reference price.
  patienceMinutes: number;
}
export type Complaint = 'missing' | 'expensive' | 'unaffordable' | 'impatient';
export interface Offer { itemId: string; price: number; available: number }
const natural = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function chooseNeed(customer: Customer, catalog: readonly Pick<Item, 'id' | 'topic' | 'price'>[],
  sample: number): Need | undefined {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1 ||
      !Number.isFinite(customer.priceTolerance) || customer.priceTolerance <= 0 ||
      !natural(customer.patienceMinutes) || catalog.some(item => !item.id ||
        !natural(item.price) || item.price === 0)) throw Error('Invalid customer or catalog');
  const preferred = catalog.filter(item => customer.likes.includes(item.topic));
  const choices = preferred.length ? preferred : catalog;
  const item = choices[Math.floor(sample * choices.length)];
  if (!item) return undefined;
  const maxPrice = Math.floor(item.price * customer.priceTolerance);
  if (!natural(maxPrice)) throw Error('Price tolerance overflow');
  return { itemId: item.id, maxPrice };
}

export function decide(need: Need, offer: Offer | undefined, budget: number): 'buy' | Complaint {
  if (!need.itemId || !natural(need.maxPrice) || !natural(budget)) throw Error('Invalid need or budget');
  if (!offer || offer.itemId !== need.itemId) return 'missing';
  if (!natural(offer.available) || !natural(offer.price) || offer.price === 0) throw Error('Invalid offer');
  if (offer.available === 0) return 'missing';
  if (offer.price > need.maxPrice) return 'expensive';
  return offer.price > budget ? 'unaffordable' : 'buy';
}

export function stillWaiting(joinedMinute: number, patienceMinutes: number, nowMinute: number): boolean {
  if (![joinedMinute, patienceMinutes, nowMinute].every(natural) || nowMinute < joinedMinute) {
    throw Error('Invalid queue time');
  }
  return nowMinute - joinedMinute < patienceMinutes;
}
