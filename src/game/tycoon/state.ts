import type { TycoonCtx, TycoonSystem } from './system';

export interface TycoonState { version: 1; seq: number; systems: Record<string, unknown> }
type Systems = readonly TycoonSystem<unknown>[];
type CtxFor = (t: TycoonState) => TycoonCtx;

export const emptyTycoon = (): TycoonState => ({ version: 1, seq: 0, systems: {} });

export function createTycoon(systems: Systems, ctx: CtxFor): TycoonState {
  return restoreTycoon(emptyTycoon(), systems, ctx);
}

/** Unknown system keys are kept as saved; missing ones are created. Throws on an invalid save. */
export function restoreTycoon(raw: unknown, systems: Systems, ctx: CtxFor): TycoonState {
  const saved = raw as Partial<TycoonState> | null;
  if (!saved || typeof saved !== 'object' || saved.version !== 1 || !Number.isSafeInteger(saved.seq) || saved.seq! < 0 ||
      !saved.systems || typeof saved.systems !== 'object' || Array.isArray(saved.systems)) throw Error('Invalid tycoon state');
  if (new Set(systems.map(s => s.id)).size !== systems.length) throw Error('Duplicate tycoon system');
  const t: TycoonState = { version: 1, seq: saved.seq!, systems: { ...saved.systems } };
  for (const system of systems) t.systems[system.id] = Object.hasOwn(saved.systems, system.id)
    ? system.validate(saved.systems[system.id], ctx(t)) : system.create(ctx(t));
  return t;
}

export function runMinute(t: TycoonState, systems: Systems, ctx: CtxFor, minute: number): void {
  let c: TycoonCtx | undefined; // Built only when some system listens: empty registries cost nothing per minute.
  for (const system of systems) system.onMinute?.(c ??= ctx(t), t.systems[system.id], minute);
}

export function runBeforeMinute(t: TycoonState, systems: Systems, ctx: CtxFor, minute: number): void {
  let c: TycoonCtx | undefined;
  for (const system of systems) system.beforeMinute?.(c ??= ctx(t), t.systems[system.id], minute);
}

export function runDay(t: TycoonState, systems: Systems, ctx: CtxFor, day: number): void {
  let c: TycoonCtx | undefined;
  for (const system of systems) system.onDay?.(c ??= ctx(t), t.systems[system.id], day);
}
