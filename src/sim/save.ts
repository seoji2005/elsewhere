import type { WorldState } from './world';

export const SAVE_VERSION = 1;
export function saveWorld(world: WorldState): string {
  return JSON.stringify({ version: SAVE_VERSION, world });
}

export function restoreWorld(json: string): WorldState {
  const save = JSON.parse(json);
  if (save?.version !== SAVE_VERSION) throw Error('Unsupported save version');
  if (!save.world || typeof save.world !== 'object' ||
      ['clock', 'ledger', 'people', 'places', 'companies', 'relationships'].some(key =>
        !save.world[key] || typeof save.world[key] !== 'object' || Array.isArray(save.world[key]))) {
    throw Error('Invalid save state');
  }
  return save.world as WorldState;
}
