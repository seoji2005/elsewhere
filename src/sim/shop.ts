import { items, type Item } from '../data/items';
import type { Npc } from '../data/npcs';
import type { GameTime } from './clock';
import { transfer, type LedgerState, type TransferResult } from './ledger';
import { validateTime } from './npc';
import { interact, type RelationshipState, type Interaction } from './relationship';
import type { WorldState } from './world';

export interface Purchase { id: string; actorId: string; itemId: string }
export interface Lifestyle {
  inventory: Record<string, number>; energy: number;
  appearance: number; atmosphere: number; clothing: string | null; decorations: string[];
}
export interface ShopState { purchases: Purchase[]; residents: Record<string, Lifestyle> }
export function createShopState(): ShopState { return { purchases: [], residents: {} }; }
function resident(state: ShopState, actorId: string): Lifestyle {
  return state.residents[actorId] ??= { inventory: {}, energy: 50, appearance: 0,
    atmosphere: 0, clothing: null, decorations: [] };
}
function owned(state: ShopState, actorId: string, itemId: string): [Lifestyle, Item] {
  const item = items.find(entry => entry.id === itemId);
  const life = state.residents[actorId];
  if (!item || !life || !(life.inventory[itemId] > 0)) throw Error('Item not owned');
  return [life, item];
}

// Request IDs must be unique; retries with the same ID cannot charge or grant items twice.
export function buyItem(state: ShopState, ledger: LedgerState, requestId: string,
  actorId: string, itemId: string, time: GameTime): TransferResult {
  validateTime(time);
  const item = items.find(entry => entry.id === itemId);
  if (!requestId || !actorId || actorId === 'shop' || !item) {
    return { ok: false, error: 'Invalid purchase' };
  }
  const previous = state.purchases.find(entry => entry.id === requestId);
  if (previous) return previous.actorId === actorId && previous.itemId === itemId
    ? { ok: true, duplicate: true } : { ok: false, error: 'Purchase ID conflict' };
  const result = transfer(ledger, { id: `purchase:${requestId}`, from: actorId, to: 'shop',
    amount: item.price, time, reason: `Purchase: ${itemId}` });
  if (result.ok) {
    const life = resident(state, actorId);
    life.inventory[itemId] = (life.inventory[itemId] ?? 0) + 1;
    state.purchases.push({ id: requestId, actorId, itemId });
  }
  return result;
}

export function useItem(state: ShopState, actorId: string, itemId: string): Lifestyle {
  const [life, item] = owned(state, actorId, itemId);
  if (item.category === 'food') life.energy = Math.min(100, life.energy + item.energy);
  else if (item.category === 'clothing') {
    if (life.clothing) life.inventory[life.clothing] = (life.inventory[life.clothing] ?? 0) + 1;
    life.clothing = itemId;
    life.appearance = item.appearance;
  } else {
    life.decorations.push(itemId);
    life.atmosphere += item.atmosphere;
  }
  life.inventory[itemId]--;
  return life;
}

export function giveGift(state: ShopState, world: Pick<WorldState, 'relationships'>,
  relationships: RelationshipState, actorId: string, npc: Npc,
  itemId: string, time: GameTime): Interaction {
  const [life, item] = owned(state, actorId, itemId);
  const result = interact(world, relationships, actorId, npc, time,
    { id: `gift:${itemId}`, topic: item.topic, tone: item.tone });
  life.inventory[itemId]--;
  return result;
}
