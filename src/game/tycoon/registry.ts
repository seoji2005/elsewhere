import type { TycoonSystem } from './system';
import { patrons } from './patrons';
import { haul } from './haul';
import { counsel } from './counsel';
import { leisureSystem } from './leisure';
import { cityEvents } from './cityEvents';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [cityEvents, patrons, haul, counsel, leisureSystem];
