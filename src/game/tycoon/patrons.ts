// C095: C088 personas at the player's shop — assignment, regulars, parking, haggling and the customers' lines.
import { personas, situations, type PersonaId, type Situation } from '../../data/personas';
import { assignPersona, bark, parkingEffect, promotePersona } from '../../sim/persona';
import { restock, setPrice, visitStore } from '../../sim/store';
import { checkoutBusiness } from '../../sim/business';
import type { ShopEvent, TycoonCtx, TycoonSystem } from './system';

export interface PatronLine { minute: number; npcId: string; name: string; personaId: PersonaId; situation: Situation; text: string }
/** offer: the haggler's price (their maxPrice, within 10% under the list price). */
export interface Haggle { visitId: string; npcId: string; businessId: string; itemId: string; offer: number; minute: number }
export interface PatronState {
  personas: Record<string, PersonaId>; visits: Record<string, number>;
  parking: number[]; haggles: Haggle[]; feed: PatronLine[];
}
export const parkingSpaces = 2, haggleMinutes = 60;
const minuteOf = (ctx: TycoonCtx) => (ctx.time.day - 1) * 1440 + ctx.time.hour * 60 + ctx.time.minute;

/** Base persona saved on first sight; three completed visits promote it to 'regular'. */
export function personaOf(ctx: TycoonCtx, s: PatronState, npcId: string): PersonaId {
  s.personas[npcId] ??= assignPersona(ctx.residents.find(n => n.id === npcId) ?? {}, ctx.roll('patrons', npcId, 0));
  return promotePersona(s.personas[npcId], s.visits[npcId] ?? 0);
}
// Big spenders and parking hogs always drive; half of the busy office workers do.
const drives = (ctx: TycoonCtx, id: PersonaId, npcId: string) =>
  id === 'bigSpender' || id === 'parkingHog' || id === 'rusher' && ctx.roll('patrons', `car:${npcId}`, 0) < 0.5;
/** False when this visitor drives and both spaces are taken; a hog then holds one space for 20 minutes. */
export function park(ctx: TycoonCtx, s: PatronState, npcId: string, id: PersonaId): boolean {
  if (!drives(ctx, id, npcId)) return true;
  const now = minuteOf(ctx);
  s.parking = s.parking.filter(until => until > now);
  if (s.parking.length >= parkingSpaces) return false;
  const { occupiedUntil } = parkingEffect(id, now, now, parkingSpaces);
  if (occupiedUntil > now) s.parking.push(occupiedUntil);
  return true;
}
function say(ctx: TycoonCtx, s: PatronState, npcId: string, situation: Situation) {
  const minute = minuteOf(ctx), personaId = personaOf(ctx, s, npcId);
  const text = bark(personaId, situation, ctx.roll('patrons', `${npcId}:${situation}`, minute));
  // The same line at most once a day, so a busy hour does not repeat itself.
  if (s.feed.some(l => l.text === text && Math.floor(l.minute / 1440) === Math.floor(minute / 1440))) return;
  s.feed.push({ minute, npcId, name: ctx.residents.find(n => n.id === npcId)?.name ?? npcId, personaId, situation, text });
  s.feed = s.feed.slice(-30);
}
/** The player's answer to a pending haggle: accept sells one at the offered price, refuse is a lost 'expensive' sale. */
export function answerHaggle(ctx: TycoonCtx, s: PatronState, visitId: string, accept: boolean): boolean {
  const h = s.haggles.find(h => h.visitId === visitId), b = ctx.book.businesses.find(b => b.id === h?.businessId);
  if (!h || !b) return false; // already answered, or the customer left
  s.haggles = s.haggles.filter(x => x !== h);
  const stock = b.store.stock.find(st => st.itemId === h.itemId);
  if (!stock) return false;
  restock(b.store, h.itemId, 5);
  if (stock.displayed === 0) return false;
  const list = stock.price, price = accept ? Math.min(h.offer, list) : list;
  setPrice(b.store, h.itemId, price); // the discount is this one sale's price only
  try {
    visitStore(b.store, ctx.world.ledger, visitId, h.npcId, { itemId: h.itemId, maxPrice: accept ? price : list - 1 }, 1, ctx.time);
    if (!accept) return say(ctx, s, h.npcId, 'expensive'), false;
    const sale = checkoutBusiness(ctx.book, ctx.world.people, ctx.world.ledger, b.id, ctx.purses[h.npcId], visitId, ctx.time);
    if (sale.ok && !sale.duplicate) patrons.onShopEvent!(ctx, s, { ...h, price, count: 1, result: 'purchased' });
    return sale.ok;
  } finally { setPrice(b.store, h.itemId, list); }
}

export const patrons: TycoonSystem<PatronState> = {
  id: 'patrons',
  create: () => ({ personas: {}, visits: {}, parking: [], haggles: [], feed: [] }),
  validate(raw) {
    const s = raw as PatronState, ids = Object.keys(personas), natural = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
    if (!s || typeof s !== 'object' || !Object.values(s.personas ?? 0).every(id => ids.includes(id)) ||
        !Object.values(s.visits ?? 0).every(natural) || !Array.isArray(s.parking) || !s.parking.every(natural) ||
        !Array.isArray(s.haggles) || !s.haggles.every(h => natural(h?.offer) && natural(h.minute)) ||
        !Array.isArray(s.feed) || !s.feed.every(l => situations.includes(l?.situation) && typeof l.text === 'string'))
      throw Error('Invalid patrons');
    return s;
  },
  onMinute(ctx, s, minute) {
    if (s.haggles.length) s.haggles = s.haggles.filter(h => minute - h.minute < haggleMinutes);
  },
  onShopEvent(ctx, s, e: ShopEvent) {
    if (e.result === 'purchased') s.visits[e.npcId] = (s.visits[e.npcId] ?? 0) + 1;
    if (e.result === 'haggle' && !s.haggles.some(h => h.visitId === `${e.businessId}:haggle:${e.npcId}:${ctx.time.day}`))
      s.haggles.push({ visitId: `${e.businessId}:haggle:${e.npcId}:${ctx.time.day}`, npcId: e.npcId, businessId: e.businessId,
        itemId: e.itemId, offer: e.price, minute: minuteOf(ctx) });
    say(ctx, s, e.npcId, e.result === 'unaffordable' ? 'expensive' : e.result);
  },
};
