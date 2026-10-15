// C106 체험 진입(?trial=1): 별도 저장 키·고정 시드로 새 세계를 정식 명령만으로 준비한다 —
// 1일째 07:00(생산자 영업 시작), 모아결 교환소 점포 계약(보증금은 원장에 남음)·찻집 개업. 상자·판매·직원은 미리 넣지 않는다.
import type { Storage } from '../game/storage';
import type { createSession } from '../game/session';

export const trial = { seed: 106, prefix: 'trial.', start: 420, storefrontId: 'shop-unit', kind: 'tea' } as const;
/** Every key (save, backups) under trial.*: the trial never reads or overwrites the main save. */
export const trialStorage = (base: Storage): Storage => ({
  getItem: key => base.getItem(trial.prefix + key), setItem: (key, value) => base.setItem(trial.prefix + key, value) });
/** Prepares a brand-new trial world; an existing trial save is left as it is. Returns whether it was new. */
export function prepareTrial(session: ReturnType<typeof createSession>): boolean {
  if (session.state.world.clock.totalMinutes > 0 || session.state.leases.length) return false;
  session.skipTo(trial.start);
  session.rentStore(trial.storefrontId);
  session.openShop(trial.kind);
  return true;
}
