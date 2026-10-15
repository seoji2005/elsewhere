import type { GameTime } from '../../sim/clock';
import type { WorldState } from '../../sim/world';
import type { BusinessBook, Lease } from '../../sim/business';
import type { Purse } from '../../sim/purse';
import type { Npc } from '../../data/npcs';
import type { Leg } from '../../sim/tycoonCore';
import type { TransferResult } from '../../sim/ledger';

export interface TycoonCtx {
  world: WorldState; book: BusinessBook; leases: Lease[]; purses: Record<string, Purse>;
  residents: readonly Npc[]; npcSeed: number; player: { x: number; z: number; direction: number; placeId: string };
  time: GameTime;
  /** tycoonCore.roll with this world's npcSeed. */
  roll(system: string, entity: string, index: number): number;
  /** tycoonCore.settle on this world's ledger at ctx.time. */
  settle(batchId: string, legs: readonly Leg[]): TransferResult;
  /** tycoonCore.nextId on the saved tycoon sequence. */
  nextId(kind: string): string;
  /** Where a resident is at ctx.time (tick-size independent). world.people[].placeId is only refreshed at the end of a tick — do not read it. */
  placeOf(npcId: string): string;
  /** Other systems' states: read only. */
  systems: Readonly<Record<string, unknown>>;
}

/** One tycoon feature. State must be JSON-serialisable; create must not move money. */
export interface TycoonSystem<S> {
  id: string;
  create(ctx: TycoonCtx): S;
  /** Returns a checked state from a save; throws when it is invalid. */
  validate(raw: unknown, ctx: TycoonCtx): S;
  /** After the session's own processing for this minute. */
  onMinute?(ctx: TycoonCtx, s: S, minute: number): void;
  /** Once per day, after the day's close at 23:59 (shops settled, market advanced). */
  onDay?(ctx: TycoonCtx, s: S, day: number): void;
}
