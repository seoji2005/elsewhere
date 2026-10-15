import type { TycoonSystem } from './system';
import { patrons } from './patrons';
import { ads } from './ads';
import { haul } from './haul';
import { counsel } from './counsel';
import { leisureSystem } from './leisure';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [patrons, ads, haul, counsel, leisureSystem];
