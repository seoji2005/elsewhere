import { items } from './items';
export const shopKinds = { tea: ['tea', 'bread', 'soup'], general: ['scarf', 'lamp', 'chime'] } as const;
export type ShopKind = keyof typeof shopKinds;
// A new storefront activates the neighbourhood's shopping stops and production bonuses.
export const retailDemand = { visitChance: 60, dailyBudget: 48, productionBonus: 24, employerReserve: 300 } as const;
export const storefronts = [
  { id: 'cafe-unit', placeId: 'cafe', landlordId: 'sori', deposit: 40, dailyRent: 4, capacity: 1, kinds: ['tea'] },
  { id: 'shop-unit', placeId: 'shop', landlordId: 'sori', deposit: 60, dailyRent: 6, capacity: 2, kinds: ['general', 'tea'] },
] as const;
export function shopStock(kind: ShopKind) {
  return items.filter(i => (shopKinds[kind] as readonly string[]).includes(i.id))
    .map(i => ({ itemId: i.id, price: i.price, capacity: 20, backroom: 0, displayed: 0 }));
}
