import type { TycoonSystem } from './system';
import { counsel } from './counsel';

/** Processing order = array order. Add a system with one import and one entry. */
export const tycoonSystems: TycoonSystem<any>[] = [counsel];
