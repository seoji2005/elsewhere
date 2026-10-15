import type { TycoonSystem } from './system';
import { patrons } from './patrons';
import { haul } from './haul';
import { counsel } from './counsel';
import { leisureSystem } from './leisure';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [patrons, haul, counsel, leisureSystem];
