import type { GameTime } from './clock';
import type { Consent, DialogueState } from './dialogue';
import { createEncounterState, hasMet } from './encounter';
import { minuteOf } from './memory';
import type { Interaction, relationshipStages } from './relationship';
import type { WorldState } from './world';

export const axes = ['affection', 'trust', 'respect', 'comfort', 'romance'] as const;
export type Axis = typeof axes[number];
export type Bond = Record<Axis, number> & { met: boolean; legacyScore?: number };
export interface BondEffect { fromId: string; toId: string; delta: Partial<Record<Axis, number>>; met?: true }
export interface Bonds { version: 1; edges: Record<string, Bond>; gained: Record<string, number>; applied: string[] }
export const createBonds = (): Bonds => ({ version: 1, edges: {}, gained: {}, applied: [] });
export const edgeKey = (from: string, to: string) => JSON.stringify([from, to]);
export const emptyBond = (): Bond => ({ affection: 0, trust: 0, respect: 0, comfort: 0, romance: 0, met: false });
export const readBond = (state: Bonds, from: string, to: string): Bond =>
  ({ ...(state.edges[edgeKey(from, to)] ?? emptyBond()) });
const clamp = (value: number, axis: Axis) => Math.max(axis === 'romance' ? 0 : -100, Math.min(100, value));

// Keep legacy scores and recorded meetings; never translate scores or invent reverse feelings.
export function seedLegacy(world: Pick<WorldState, 'relationships'>, encounters = createEncounterState()): Bonds {
  const state = createBonds();
  const seed = (from: string, to: string, legacyScore?: number) => {
    if (!from || !to || from === to || (legacyScore !== undefined && !Number.isFinite(legacyScore))) {
      throw Error('Invalid legacy edge');
    }
    state.edges[edgeKey(from, to)] = { ...emptyBond(), met: hasMet(encounters, world, from, to),
      ...(legacyScore === undefined ? {} : { legacyScore }) };
  };
  for (const [from, targets] of Object.entries(world.relationships)) {
    for (const [to, score] of Object.entries(targets)) seed(from, to, score);
  }
  const meetings = [...encounters.met, ...Object.entries(encounters.memories).flatMap(([npcId, memory]) =>
    memory.entries.map(entry => ({ actorId: entry.subjectId, npcId })))];
  for (const { actorId, npcId } of meetings) {
    if (!state.edges[edgeKey(actorId, npcId)]) seed(actorId, npcId);
  }
  return state;
}
export function datingPair(state: Pick<DialogueState, 'dating'>, a: string, b: string): boolean {
  return state.dating.some(pair => (pair.actorId === a && pair.npcId === b)
    || (pair.actorId === b && pair.npcId === a));
}
export const friendly = (bond: Bond) => bond.met && bond.affection >= 30
  && bond.trust >= 15 && bond.comfort >= 10 && bond.respect >= 0;
export function stageOf(state: Bonds, from: string, to: string,
  dating: Pick<DialogueState, 'dating'> = { dating: [] }): typeof relationshipStages[number]['name'] {
  if (datingPair(dating, from, to)) return '연인 첫 단계';
  const bond = readBond(state, from, to);
  return friendly(bond) ? bond.romance >= 40 ? '호감' : '친구' : bond.met ? '아는 사이' : '낯섦';
}
export function canStartDating(a: Bond, b: Bond, consent: Consent): boolean {
  const ready = (bond: Bond) => friendly(bond) && bond.affection >= 40
    && bond.trust >= 25 && bond.comfort >= 20 && bond.romance >= 60;
  return consent.playerWantsDating === true && consent.npcWantsDating === true && ready(a) && ready(b);
}
export function reactionEffect(entry: Interaction): BondEffect {
  return { fromId: entry.npcId, toId: entry.actorId, met: true,
    delta: { affection: entry.change * 7 / 10, comfort: entry.change * 3 / 10 } };
}
// Commit atomically; actual positive gains share 10 per direction/day. Losses never refund it.
export function applyBondEvent(state: Bonds, id: string, time: GameTime, effects: readonly BondEffect[]): boolean {
  minuteOf(time);
  if (!id) throw Error('Missing event ID');
  if (state.applied.includes(id)) return false;
  const edges = { ...state.edges }, gained = { ...state.gained };
  for (const { fromId, toId, delta, met } of effects) {
    if (!fromId || !toId || fromId === toId) throw Error('Invalid edge');
    if (Object.entries(delta).some(([axis, value]) => !axes.includes(axis as Axis)
      || !Number.isFinite(value))) throw Error('Invalid delta');
    const key = edgeKey(fromId, toId), dayKey = JSON.stringify([fromId, toId, time.day]);
    const bond = { ...(edges[key] ?? emptyBond()) };
    const changes = axes.map(axis => clamp(bond[axis] + (delta[axis] ?? 0), axis) - bond[axis]);
    const positive = changes.reduce((sum, change) => sum + Math.max(0, change), 0);
    const available = Math.max(0, 10 - (gained[dayKey] ?? 0));
    const factor = positive ? Math.min(1, available / positive) : 1;
    axes.forEach((axis, index) => bond[axis] += changes[index] > 0 ? changes[index] * factor : changes[index]);
    bond.met ||= met === true;
    edges[key] = bond;
    gained[dayKey] = (gained[dayKey] ?? 0) + Math.min(positive, available);
  }
  state.edges = edges;
  state.gained = gained;
  state.applied.push(id);
  return true;
}
