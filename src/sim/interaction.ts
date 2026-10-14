export interface Point { readonly x: number; readonly z: number }
export interface Target {
  readonly id: string;
  readonly sceneId: string;
  readonly action: 'enter' | 'exit' | 'talk' | 'work' | 'shop';
  readonly position: Point;
  readonly radius: number;
  readonly priority: number;
  readonly enabled: boolean;
  readonly visible: boolean;
}
export interface Selection { readonly target: Target; readonly distance: number }
const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.z);
export function selectTarget(player: Point, sceneId: string, targets: readonly Target[], previousId?: string, blocked = false): Selection | null {
  if (blocked || !finitePoint(player)) return null;
  const candidates: Selection[] = [];
  for (const target of targets) {
    if (target.sceneId !== sceneId || !target.enabled || !target.visible || !finitePoint(target.position) ||
        !Number.isFinite(target.radius) || target.radius < 0 || !Number.isFinite(target.priority)) continue;
    const distance = Math.hypot(player.x - target.position.x, player.z - target.position.z);
    if (distance <= target.radius) candidates.push({ target, distance });
  }
  candidates.sort((a, b) => b.target.priority - a.target.priority || a.distance - b.distance ||
    (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0));
  const best = candidates[0], previous = candidates.find(entry => entry.target.id === previousId);
  if (!best) return null;
  return previous && previous.target.priority === best.target.priority && previous.distance <= best.distance + 0.25 ? previous : best;
}
export function resolveTap(id: string, player: Point, sceneId: string, targets: readonly Target[], blocked = false): Target | null {
  const selected = selectTarget(player, sceneId, targets, id, blocked);
  return selected?.target.id === id ? selected.target : null;
}
