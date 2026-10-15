import { shows, type Show, type ShowScene } from '../../data/shows';
import { places } from '../../data/places';
import { applyBondEvent } from '../../sim/bonds';
import { createMemoryState, minuteOf, rememberSharedEvent } from '../../sim/memory';
import type { createSession } from '../session';
import type { TycoonCtx, TycoonSystem } from './system';

export interface Ticket {
  id: string; showId: string; day: number; companionId: string | null;
  /** missed → closed once the companion's disappointment is applied. */
  status: 'booked' | 'attended' | 'missed' | 'closed'; sceneId: string | null;
}
export interface LeisureState { tickets: Ticket[] }
const statuses = ['booked', 'attended', 'missed', 'closed'];
const showOf = (id: string) => shows.find(s => s.id === id);
const sameNight = (a: Ticket, b: Ticket) => a.showId === b.showId && a.day === b.day;

export const leisureSystem: TycoonSystem<LeisureState> = {
  id: 'leisure',
  create: () => ({ tickets: [] }),
  validate(raw) {
    const s = raw as LeisureState;
    if (!s || !Array.isArray(s.tickets) || !s.tickets.every(t => t && typeof t.id === 'string' && showOf(t.showId)
      && Number.isSafeInteger(t.day) && t.day >= 1 && (t.companionId === null || typeof t.companionId === 'string')
      && statuses.includes(t.status) && (t.sceneId === null || showOf(t.showId)!.scenes.some(c => c.id === t.sceneId)))) {
      throw Error('Invalid leisure state');
    }
    return s;
  },
  // Attending means being at the venue at some minute of the show; whoever is not there by the end missed it.
  onMinute(ctx, s, minute) {
    const day = Math.floor(minute / 1440) + 1, at = minute % 1440;
    for (const t of s.tickets) {
      const show = showOf(t.showId)!;
      if (t.day !== day || t.status !== 'booked') continue;
      if (at >= show.start && at < show.end && ctx.player.placeId === show.placeId) t.status = 'attended';
      else if (at >= show.end) t.status = 'missed';
    }
  },
  onDay(_ctx, s, day) {
    s.tickets = s.tickets.filter(t => t.day > day - 14 || t.status === 'missed');
  },
};

export function buyTicket(ctx: TycoonCtx, s: LeisureState, showId: string, companionId: string | null,
  stage: (npcId: string) => string): Ticket {
  const show = showOf(showId), at = ctx.time.hour * 60 + ctx.time.minute;
  if (!show) throw Error('Unknown show');
  if (at >= show.end) throw Error('Show over');
  if (companionId !== null && (companionId === show.hostId || !ctx.residents.some(n => n.id === companionId)
    || stage(companionId) === '낯섦')) throw Error('Not acquainted');
  const id = ctx.nextId('leisure'), leg = { from: 'player', to: show.hostId, amount: show.price, reason: `Leisure: ${show.id}` };
  const result = ctx.settle(id, companionId === null ? [leg] : [leg, leg]); // The player treats the companion.
  if (!result.ok) throw Error(result.error);
  const ticket: Ticket = { id, showId, day: ctx.time.day, companionId, status: 'booked', sceneId: null };
  s.tickets.push(ticket);
  return ticket;
}

type Session = ReturnType<typeof createSession>;
const memoryId = (t: Ticket) => `leisure:${t.showId}:${t.day}`;

/** Session-side effects (memories, energy, bonds) live outside the tycoon context, so commands go through here. */
export function leisure(session: Session) {
  const { state } = session;
  const command = <T>(fn: (ctx: TycoonCtx, s: LeisureState) => T) => session.tycoon.command('leisure', fn);
  const unpicked = (t: Ticket) => {
    const now = minuteOf(session.tycoon.ctx().time);
    return t.status === 'attended' && !t.sceneId && now >= (t.day - 1) * 1440 + showOf(t.showId)!.end;
  };
  const enjoy = (ctx: TycoonCtx, show: Show, scene: ShowScene, night: Ticket[]) => {
    for (const t of night) t.sceneId = scene.id;
    const life = state.shop.residents.player ??= { inventory: {}, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
    life.energy = Math.min(100, life.energy + 15);
    const companions = [...new Set(night.flatMap(t => t.companionId ?? []))];
    for (const id of companions) rememberSharedEvent(state.dialogue.memories[id] ??= createMemoryState(id), {
      id: memoryId(night[0]), actorId: 'player', kind: 'shared-work', participants: ['player', ...companions],
      placeId: show.placeId, placeName: places.find(p => p.id === show.placeId)!.name, activityName: scene.memory,
      time: ctx.time, status: 'completed' });
    return scene;
  };
  const today = () => (session.tycoon.state().systems.leisure as LeisureState).tickets
    .filter(t => t.day === session.tycoon.ctx().time.day);
  return {
    today,
    buyTicket: (showId: string, companionId?: string) =>
      command((ctx, s) => buyTicket(ctx, s, showId, companionId ?? null, session.stageFor)),
    /** A taste pick during the show: once per show night, however many tickets were bought. */
    choose: (sceneId: string) => command((ctx, s) => {
      const show = shows.find(x => x.scenes.some(c => c.id === sceneId)), scene = show?.scenes.find(c => c.id === sceneId);
      const night = s.tickets.filter(t => t.showId === show?.id && t.day === ctx.time.day);
      if (!show || !scene || !night.some(t => t.status === 'attended') || ctx.player.placeId !== show.placeId
        || ctx.time.hour * 60 + ctx.time.minute >= show.end) throw Error('Not attending');
      if (night.some(t => t.sceneId)) throw Error('Already chosen');
      return enjoy(ctx, show, scene, night);
    }),
    /** C113: the show that needs the player now — booked from 10 minutes before, or attended without a pick while it runs. */
    due() {
      const at = minuteOf(session.tycoon.ctx().time) % 1440;
      for (const t of today()) {
        const show = showOf(t.showId)!;
        if (t.status === 'booked' && at >= show.start - 10 && at < show.end
          || t.status === 'attended' && !t.sceneId && at >= show.start && at < show.end) return { ticket: t, show };
      }
    },
    /** Applies a no-show to the companion who waited; call it often, it only saves when something changed. */
    sync() {
      const s = session.tycoon.state().systems.leisure as LeisureState;
      if (!s.tickets.some(t => t.status === 'missed' || unpicked(t))) return;
      command((ctx, s) => {
        // C113: there to the end (e.g. a skip ran through the show) without a pick → the opening scene is the memory.
        for (const t of s.tickets.filter(unpicked)) {
          const show = showOf(t.showId)!;
          enjoy(ctx, show, show.scenes[0], s.tickets.filter(x => sameNight(x, t)));
        }
        for (const t of s.tickets.filter(x => x.status === 'missed')) {
          const id = `leisure-no-show:${memoryId(t)}:${t.companionId}`, first = !s.tickets.some(x => x.status === 'closed'
            && sameNight(x, t) && x.companionId === t.companionId);
          if (t.companionId && state.relationMode === 'bonds') applyBondEvent(state.bonds, id, ctx.time,
            [{ fromId: t.companionId, toId: 'player', delta: { trust: -5, comfort: -3 } }]);
          else if (t.companionId && first) {
            const scores = state.world.relationships.player ??= {};
            scores[t.companionId] = (scores[t.companionId] ?? 0) - 3;
          }
          t.status = 'closed';
        }
      });
    },
    /** From the day after the show, the companion brings it up once. */
    recall(npcId: string): string | undefined {
      const memories = state.dialogue.memories[npcId], now = minuteOf(session.tycoon.ctx().time);
      const m = memories?.entries.find(e => e.sourceEventId?.startsWith('leisure:') && e.mentionedAt === undefined
        && Math.floor(e.created / 1440) < Math.floor(now / 1440) && now - e.created < 14 * 1440);
      if (!m) return;
      m.mentionedAt = now;
      return `${m.placeName}에서 같이 본 공연 기억나요? ${m.topic}… 아직도 생각나요.`;
    },
  };
}
