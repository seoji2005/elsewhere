// C095b: the shop floor — crowd level, customers' chats about real records, the first sale and regulars' signals.
import { items } from '../../data/items';
import { crowdLevels, fill, sceneLines, talks } from '../../data/shopScene';
import { parkingSpaces, type PatronState } from './patrons';
import type { ShopEvent, TycoonCtx, TycoonSystem } from './system';

export type SceneKind = 'talk' | 'fast' | 'first' | 'again' | 'usual' | 'guess';
/** fact: the record a chat points at, e.g. 'price:tea:8', 'soldout:bread', 'parking:2', 'regular:<npcId>'. */
export interface SceneLine { minute: number; npcId: string; name: string; kind: SceneKind; text: string; fact?: string }
export interface FirstSale { minute: number; npcId: string; itemId: string; price: number }
export interface SceneState {
  /** This hour's floor: customers in the shop, checkouts with the owner present, whether customers already chatted. */
  hour: number; present: string[]; sold: number; talked: boolean;
  first: FirstSale | null; regulars: Record<string, 1 | 2>; guessed: Record<string, boolean>;
  asks: { npcId: string; itemId: string; minute: number }[]; feed: SceneLine[];
}
const minuteOf = (ctx: TycoonCtx) => (ctx.time.day - 1) * 1440 + ctx.time.hour * 60 + ctx.time.minute;
const itemName = (id: string) => items.find(i => i.id === id)?.name ?? id;
const nameOf = (ctx: TycoonCtx, id: string) => ctx.residents.find(n => n.id === id)?.name ?? id;
export const crowdOf = (s: SceneState) => [...crowdLevels].reverse().find(l => s.present.length >= l.min)!;

function line(ctx: TycoonCtx, s: SceneState, npcId: string, kind: SceneKind, text: string, fact?: string) {
  s.feed.push({ minute: minuteOf(ctx), npcId, name: nameOf(ctx, npcId), kind, text, ...fact ? { fact } : {} });
  s.feed = s.feed.slice(-30);
}
function newHour(s: SceneState, hour: number) {
  if (s.hour !== hour) Object.assign(s, { hour, present: [], sold: 0, talked: false });
}
/** Real records at the shop right now; a chat is only made from one of these. */
export function facts(ctx: TycoonCtx, s: SceneState, e: ShopEvent) {
  const b = ctx.book.businesses.find(b => b.id === e.businessId), pat = ctx.systems.patrons as PatronState | undefined;
  const out: { kind: keyof typeof talks; fact: string; values: Record<string, string | number>; speaker?: string }[] = [];
  const stock = b?.store.stock.find(st => st.itemId === e.itemId), ref = items.find(i => i.id === e.itemId)?.price;
  if (stock && ref) out.push({ kind: stock.price < ref ? 'cheap' : stock.price > ref ? 'dear' : 'fair',
    fact: `price:${stock.itemId}:${stock.price}`, values: { item: itemName(stock.itemId), price: stock.price } });
  for (const st of b?.store.stock ?? []) if (st.backroom + st.displayed === 0)
    out.push({ kind: 'soldout', fact: `soldout:${st.itemId}`, values: { item: itemName(st.itemId) } });
  if (pat && pat.parking.filter(until => until > minuteOf(ctx)).length >= parkingSpaces)
    out.push({ kind: 'parking', fact: `parking:${parkingSpaces}`, values: { count: parkingSpaces } });
  const regular = s.present.find(id => (pat?.visits[id] ?? 0) >= 3);
  if (regular && stock) out.push({ kind: 'regular', fact: `regular:${regular}`, values: { item: itemName(stock.itemId) }, speaker: regular });
  return out;
}
/** The player's guess at a regular's usual item: relationship only, no money. */
export function guessUsual(ctx: TycoonCtx, s: SceneState, npcId: string, itemId: string): boolean {
  const ask = s.asks.find(a => a.npcId === npcId);
  if (!ask) return false;
  s.asks = s.asks.filter(a => a !== ask);
  s.guessed[npcId] = ask.itemId === itemId;
  line(ctx, s, npcId, 'guess', s.guessed[npcId] ? sceneLines.right : fill(sceneLines.wrong, { item: itemName(ask.itemId) }));
  return s.guessed[npcId];
}

export const scene: TycoonSystem<SceneState> = {
  id: 'scene',
  create: () => ({ hour: 0, present: [], sold: 0, talked: false, first: null, regulars: {}, guessed: {}, asks: [], feed: [] }),
  validate(raw) {
    const s = raw as SceneState, natural = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
    if (!s || typeof s !== 'object' || !natural(s.hour) || !Array.isArray(s.present) || !natural(s.sold) ||
        typeof s.talked !== 'boolean' || s.first !== null && !natural(s.first?.price) ||
        !Object.values(s.regulars ?? 0).every(v => v === 1 || v === 2) || typeof s.guessed !== 'object' ||
        !Array.isArray(s.asks) || !Array.isArray(s.feed) || !s.feed.every(l => typeof l?.text === 'string'))
      throw Error('Invalid scene');
    return s;
  },
  onMinute(ctx, s, minute) {
    newHour(s, Math.floor(minute / 60));
    if (s.asks.length) s.asks = s.asks.filter(a => minute - a.minute < 60);
  },
  onShopEvent(ctx, s, e) {
    if (e.result === 'parkingFull') return; // never came in
    const minute = minuteOf(ctx), b = ctx.book.businesses.find(b => b.id === e.businessId);
    newHour(s, Math.floor(minute / 60));
    if (!s.present.includes(e.npcId)) {
      s.present.push(e.npcId);
      // Customers chat about one real record, at most once an hour, more often the busier it is.
      if (s.present.length >= 2 && !s.talked && ctx.roll('scene', `talk:${s.hour}`, s.present.length) < crowdOf(s).talk) {
        const found = facts(ctx, s, e);
        const f = found[Math.floor(ctx.roll('scene', `fact:${s.hour}`, s.present.length) * found.length)];
        if (f) {
          const a = f.speaker ?? s.present.at(-2)!, other = s.present.at(-1) === a ? s.present.at(-2)! : s.present.at(-1)!;
          line(ctx, s, a, 'talk', fill(talks[f.kind][0], f.values), f.fact);
          line(ctx, s, other, 'talk', fill(talks[f.kind][1], f.values), f.fact);
          s.talked = true;
        }
      }
    }
    if (e.result !== 'purchased') return;
    if (!s.first) {
      s.first = { minute, npcId: e.npcId, itemId: e.itemId, price: e.price };
      line(ctx, s, e.npcId, 'first', sceneLines.first);
    }
    // Three checkouts in an hour with the owner at the counter: the customers notice. No money.
    if (b && ctx.player.placeId === b.placeId && ++s.sold === 3)
      line(ctx, s, e.npcId, 'fast', sceneLines.fast[Math.floor(ctx.roll('scene', `fast:${s.hour}`, 0) * 2)]);
    const visits = (ctx.systems.patrons as PatronState | undefined)?.visits[e.npcId] ?? 0;
    if (visits === 2 && !s.regulars[e.npcId]) {
      s.regulars[e.npcId] = 1;
      line(ctx, s, e.npcId, 'again', sceneLines.again);
    } else if (visits >= 3 && s.regulars[e.npcId] !== 2) {
      s.regulars[e.npcId] = 2;
      s.asks.push({ npcId: e.npcId, itemId: e.itemId, minute });
      line(ctx, s, e.npcId, 'usual', sceneLines.usual);
    }
  },
};
