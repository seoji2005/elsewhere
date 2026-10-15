// C100: 원인 사슬 검사·발주 조건·주차 통제 조회. 상태를 바꾸지 않는 순수 함수만.
import { partnerLot, roadworks } from '../data/cityEvents';

export interface CauseRecord {
  id: string; kind: 'maintenanceAuthorization' | 'roadworks' | 'shopImpact';
  parentId: string | null; depth: 0 | 1 | 2; sourceIds: string[]; minute: number;
}
export interface Response { kind: 'breakfast' | 'parking' | 'none'; minute: number; itemId?: string; cost?: number }
export interface RoadEvent {
  id: string; causeId: string; requestId: string; stage: 'announced' | 'active' | 'ended' | 'cancelled';
  announcedAt: number; startAt: number; endAt: number; escrowId: string; workers: string[];
  responses: Response[]; seen: string[]; impact: { carFails: number; workerBuys: number; turned?: string[] };
}
export interface CityState {
  version: 1; prepare?: true; requests: { id: string; roadId: string; minute: number; resolvedAt: number | null }[];
  tax: Record<string, { taxable: number; paid: number }>; revenue: number; spent: number;
  causes: CauseRecord[]; events: RoadEvent[]; notices: { eventId: string; observerId: string; sourceId: string; learnedAt: number; hops: 0 | 1 | 2 }[];
}

/** 부모가 있고 깊이가 하나씩 늘며 2를 넘지 않고, 조상이 순환하지 않으면 참. */
export function validCauses(causes: readonly CauseRecord[]): boolean {
  const byId = new Map(causes.map(c => [c.id, c]));
  return byId.size === causes.length && causes.every(c => {
    let node: CauseRecord | undefined = c;
    for (let steps = 0; node; steps++) {
      if (steps > 2 || node.depth > 2) return false;
      if (node.parentId === null) return node.depth === 0;
      const parent = byId.get(node.parentId);
      if (!parent || parent.depth !== node.depth - 1) return false;
      node = parent;
    }
    return false;
  });
}

/** 발주를 막는 이유, 없으면 ''. 미납 세금은 수입이 아니므로 revenue에 들어 있지 않다. */
export function authorizeProblem(s: CityState, cityBalance: number | undefined, freeWorkers: number): string {
  const request = s.requests.find(r => r.resolvedAt === null);
  if (cityBalance === undefined || !request) return 'No repair request';
  if (s.events.some(e => e.requestId === request.id && e.stage !== 'cancelled')) return 'Already ordered';
  if (s.revenue - s.spent < roadworks.budget) return 'Budget pending';
  if (cityBalance < roadworks.budget + roadworks.reserve) return 'City funds low';
  if (freeWorkers < roadworks.workers) return 'Workers unavailable';
  return '';
}

export const activeAt = (e: RoadEvent, minute: number) => e.stage !== 'cancelled' && e.startAt <= minute && minute < e.endAt;
/** 공사 중이면 그 사건(가게 앞 노상 주차 0칸). 기본 칸 수는 덮어쓰지 않는다. */
export const closure = (s: CityState | undefined, minute: number) => s?.events.find(e => activeAt(e, minute));
/** 공사 중 제휴 주차장의 예약 칸 수. 제휴는 공사 종료와 함께 만료된다. */
export const partnerSpaces = (s: CityState | undefined, minute: number) =>
  closure(s, minute)?.responses.some(r => r.kind === 'parking') ? partnerLot.spaces : 0;
/** 공사일 09:00~10:00 현장 근처에서 식사할 기회가 있는 인부인가(07:00~09:00 근무는 길 위라 가게 손님이 아니다). */
export function onSite(s: CityState | undefined, npcId: string, minute: number): boolean {
  const e = closure(s, minute), t = minute % 1440;
  return !!e?.workers.includes(npcId) && t >= roadworks.mealFrom && t < roadworks.mealTo;
}
