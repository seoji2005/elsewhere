// C096 직접 운반: the player buys boxes at the producer's place (no delivery fee, now) and carries them to the shop's backroom.
import { items } from '../../data/items';
import { producerJobs } from '../../sim/business';
import type { TransferResult } from '../../sim/ledger';
import type { TycoonCtx, TycoonSystem } from './system';

/** fee: this game charges delivery on session.orderStock (new games only). */
export interface HaulState { load: Record<string, number>; fee: boolean }
export const CARRY_LIMIT = 12, CARRY_SPEED = 0.8, PICKUP_HOURS = [7, 19] as const, COURIER_JOB = '공유물 순환지기';
/** Producer's price per unit, as session.orderStock. */
export const unitCost = (itemId: string) => Math.max(1, Math.floor((items.find(i => i.id === itemId)?.price ?? 4) / 4));
/** Delivery: 10% of the order, at least 2. */
export const deliveryFee = (amount: number) => Math.max(2, Math.floor(amount / 10));
export const carried = (s: HaulState) => Object.values(s.load).reduce((n, q) => n + q, 0);
export const speedFactor = (s: HaulState) => carried(s) ? CARRY_SPEED : 1;

function playerShop(ctx: TycoonCtx) {
  const lease = ctx.leases.find(l => !l.ended && l.businessId);
  return ctx.book.businesses.find(b => b.id === lease?.businessId && b.closedAt === null);
}
/** Why a pickup is refused right now, or '' when it can go ahead. */
export function pickupProblem(ctx: TycoonCtx, s: HaulState, producerId: string, itemId: string, qty: number): string {
  const producer = ctx.residents.find(n => n.id === producerId), b = playerShop(ctx);
  if (!producer || !b?.store.stock.some(x => x.itemId === itemId) || producer.job !== producerJobs[itemId]) return 'Invalid pickup';
  if (!Number.isSafeInteger(qty) || qty < 1 || carried(s) + qty > CARRY_LIMIT) return 'Too much to carry';
  if (ctx.time.hour < PICKUP_HOURS[0] || ctx.time.hour >= PICKUP_HOURS[1]) return 'Producer closed';
  if (ctx.player.placeId !== ctx.placeOf(producerId)) return 'Producer elsewhere';
  return '';
}
export function pickupOrder(ctx: TycoonCtx, s: HaulState, producerId: string, itemId: string, qty: number): TransferResult {
  const problem = pickupProblem(ctx, s, producerId, itemId, qty);
  if (problem) return { ok: false, error: problem };
  const unit = unitCost(itemId), b = playerShop(ctx)!;
  const result = ctx.settle(ctx.nextId('haul'), [{ from: 'player', to: producerId, amount: qty * unit,
    reason: `Procurement: ${b.id}:${itemId}:${qty}:${unit}` }]);
  if (result.ok && !result.duplicate) s.load[itemId] = (s.load[itemId] ?? 0) + qty;
  return result;
}
/** Moves the whole load into the backroom; only inside the player's open shop. Returns the boxes moved. */
export function dropAtShop(ctx: TycoonCtx, s: HaulState): number {
  const b = playerShop(ctx);
  if (!b || ctx.player.placeId !== b.placeId) return 0;
  let moved = 0;
  for (const [itemId, qty] of Object.entries(s.load)) {
    const stock = b.store.stock.find(x => x.itemId === itemId);
    if (!stock) continue;
    stock.backroom += qty; moved += qty; delete s.load[itemId];
  }
  return moved;
}

export const haul: TycoonSystem<HaulState> = {
  id: 'haul',
  create: () => ({ load: {}, fee: false }),
  validate(raw) {
    const { load, fee } = (raw ?? {}) as HaulState;
    if (typeof fee !== 'boolean' || !load || typeof load !== 'object' || Array.isArray(load) || Object.entries(load).some(([id, q]) =>
      !items.some(i => i.id === id) || !Number.isSafeInteger(q) || q < 1)) throw Error('Invalid haul');
    const s = { load: { ...load }, fee };
    if (carried(s) > CARRY_LIMIT) throw Error('Invalid haul');
    return s;
  },
};
