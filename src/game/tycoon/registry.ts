import type { TycoonSystem } from './system';
import { patrons } from './patrons';
import { haul } from './haul';
import { counsel } from './counsel';
import { leisureSystem } from './leisure';
import { scene } from './scene';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [patrons, scene, haul, counsel, leisureSystem];
