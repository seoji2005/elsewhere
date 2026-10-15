import type { TycoonSystem } from './system';
import { patrons } from './patrons';
import { ads } from './ads';
import { haul } from './haul';
import { counsel } from './counsel';
import { leisureSystem } from './leisure';
import { cityEvents } from './cityEvents';
import { opportunity } from './opportunity';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [cityEvents, patrons, ads, haul, counsel, leisureSystem, opportunity];
