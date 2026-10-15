import type { TycoonSystem } from './system';
import { patrons } from './patrons';
import { ads } from './ads';
import { haul } from './haul';
import { counsel } from './counsel';
import { leisureSystem } from './leisure';
import { cityEvents } from './cityEvents';
import { opportunity } from './opportunity';
import { scene } from './scene';
import { staff } from './staff';
import { rival } from './rival';
import { aiContract } from './aiContracts';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [cityEvents, patrons, scene, ads, haul, counsel, leisureSystem, opportunity, staff, rival, aiContract];
