import { createClock, type ClockState } from './clock';
import { createLedger, type LedgerState } from './ledger';

export interface Person { id: string; name: string; role: 'player' | 'npc'; placeId: string }
export interface Place { id: string; name: string }
export interface Company { id: string; name: string }
export interface WorldState {
  clock: ClockState;
  ledger: LedgerState;
  people: Record<string, Person>;
  places: Record<string, Place>;
  companies: Record<string, Company>;
  relationships: Record<string, Record<string, number>>;
}

export function createWorld(): WorldState {
  return { clock: createClock(), ledger: createLedger(), people: {}, places: {}, companies: {}, relationships: {} };
}
