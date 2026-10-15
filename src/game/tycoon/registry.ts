import type { TycoonSystem } from './system';
import { leisureSystem } from './leisure';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [leisureSystem];
