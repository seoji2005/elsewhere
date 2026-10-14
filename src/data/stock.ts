import { items } from './items';

export interface Stock {
  itemId: string; backroom: number; displayed: number; capacity: number; price: number;
}
// Initial owned stock; procurement and its costs belong to a later card.
export const initialStock: readonly Stock[] = items.slice(0, 3).map(item => ({
  itemId: item.id, backroom: 6, displayed: 0, capacity: 3, price: item.price,
}));
