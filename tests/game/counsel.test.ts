import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { currentDraft, negotiate, requestReview, reviewFee, type CounselState } from '../../src/game/tycoon/counsel';

function setup(seed: number | undefined, data = new Map<string, string>()) {
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const session = createSession(storage, seed), counsel = () => session.tycoon.state().systems.counsel as CounselState;
  const balances = session.state.world.ledger.balances, total = () => Object.values(balances).reduce((a, b) => a + b, 0);
  const run = <T>(fn: (c: Parameters<Parameters<typeof session.tycoon.command>[1]>[0], s: CounselState) => T) => session.tycoon.command('counsel', fn);
  return { session, counsel, balances, total, data, run, draft: () => currentDraft(counsel(), 'cafe-unit')! };
}
// A seed whose café contract hides a heavy-penalty clause that the assigned lawyer finds.
const seed = [...Array(400).keys()].find(n => {
  const f = setup(n), d = f.draft(), a = d.articles.find(a => a.kind === 'heavyPenalty');
  return a && f.run((c, s) => requestReview(c, s, d.id, 'lawyer')).findings.some(x => x.clause.article === a.article);
})!;
const advance = (f: ReturnType<typeof setup>, days: number) => f.session.tick(days * 1440 / f.session.state.world.clock.minutesPerSecond);

it('C101: review keeps the original text, charges once and gives the same result for the same contract', () => {
  const f = setup(seed), start = f.total(), d = f.draft(), original = structuredClone(d.articles);
  expect(d.articles.slice(0, 3).map(a => a.article)).toEqual([1, 2, 3]);
  const lawyer = f.counsel().experts.find(e => e.kind === 'lawyer')!, before = f.balances.player;
  expect([1, 2]).toContain(lawyer.tier);
  const first = f.run((c, s) => requestReview(c, s, d.id, 'lawyer'));
  expect(f.balances.player).toBe(before - reviewFee(lawyer));
  const again = f.run((c, s) => requestReview(c, s, d.id, 'lawyer'));
  expect(again).toEqual(first); expect(f.balances.player).toBe(before - reviewFee(lawyer));
  expect(() => f.run((c, s) => requestReview(c, s, d.id, 'accountant'))).toThrow();
  expect(first.done).toBe(false); advance(f, 5);
  expect(f.draft().reviews[0].done).toBe(true); expect(f.draft().articles).toEqual(original);
  expect(f.counsel().messages.at(-1)).toContain('검토 끝');
  expect(setup(seed).run((c, s) => requestReview(c, s, d.id, 'lawyer')).findings).toEqual(first.findings);
  expect(f.total()).toBe(start);
});

it('C101: signing without a lawyer shows every article; a kept penalty clause is paid when the lease ends', () => {
  const f = setup(seed), start = f.total(), d = f.draft(), articles = structuredClone(d.articles);
  const lease = f.session.rentStore('cafe-unit', d.id), signed = f.counsel().drafts.find(x => x.id === d.id)!;
  expect(signed.articles).toEqual(articles); expect(signed.reviews).toEqual([]); expect(signed.leaseId).toBe(lease.id);
  expect(currentDraft(f.counsel(), 'cafe-unit')!.id).not.toBe(d.id);
  advance(f, 1); f.session.terminateStore();
  const sori = f.balances.sori; advance(f, 1);
  const penalty = f.session.state.world.ledger.transactions.find(t => t.reason === '위약금')!;
  expect(penalty.amount).toBeGreaterThan(0); expect(f.balances.sori - sori).toBeGreaterThanOrEqual(penalty.amount);
  advance(f, 1); expect(f.session.state.world.ledger.transactions.filter(t => t.reason === '위약금')).toHaveLength(1);
  expect(f.total()).toBe(start);
});

it('C101: a negotiated-away clause has no effect; extra rent is paid; state survives save and reload', () => {
  const f = setup(seed), start = f.total(), d = f.draft(), article = d.articles.find(a => a.kind === 'heavyPenalty')!.article;
  expect(() => f.run((c, s) => negotiate(c, s, d.id, 1))).toThrow();
  f.run((c, s) => negotiate(c, s, d.id, article));
  expect(() => f.run((c, s) => negotiate(c, s, d.id, article))).toThrow();
  f.session.rentStore('cafe-unit', d.id);
  const restored = setup(undefined, f.data); expect(restored.session.loadResult.ok).toBe(true);
  expect(restored.counsel()).toEqual(f.counsel());
  advance(restored, 2);
  expect(restored.session.state.world.ledger.transactions.filter(t => t.reason === '추가 임대료').map(t => t.amount)).toEqual([1, 1]);
  restored.session.terminateStore(); advance(restored, 1);
  expect(restored.session.state.world.ledger.transactions.some(t => t.reason === '위약금')).toBe(false);
  expect(restored.counsel().drafts.find(x => x.id === d.id)!.closed).toBe(true);
  expect(restored.total()).toBe(start);
});
