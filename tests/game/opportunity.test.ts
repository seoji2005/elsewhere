import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { checkOpportunities, opportunities } from '../../src/data/opportunities';
import { answer, askQuestion, askWorry, inquire, maxShown, opportunity, shown, type OpportunityState } from '../../src/game/tycoon/opportunity';
import type { PatronState } from '../../src/game/tycoon/patrons';

function setup(seed = 7, data = new Map<string, string>()) {
  const session = createSession({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }, seed);
  const opp = () => session.tycoon.state().systems.opportunity as OpportunityState;
  const run = <T>(fn: (c: ReturnType<typeof session.tycoon.ctx>, s: OpportunityState) => T) => session.tycoon.command('opportunity', fn);
  const advance = (minutes: number) => session.tick(minutes / session.state.world.clock.minutesPerSecond);
  return { session, opp, run, advance, data };
}
const open = (s: OpportunityState) => s.opps.filter(o => o.status === 'open');

it('C102: opportunity data uses no cash or balance facts', () => {
  expect(() => checkOpportunities(opportunities)).not.toThrow();
  for (const fact of ['cash', 'balance', 'player.balance', 'made.up'])
    expect(() => checkOpportunities([{ ...opportunities[0], trigger: [{ fact, op: '>=', value: 100 }] }])).toThrow();
});

it('C102: the player balance (0 or 10000) changes nothing; split ticks agree', () => {
  const [poor, rich, split] = [setup(), setup(), setup()];
  poor.session.state.world.ledger.balances.player = 0; rich.session.state.world.ledger.balances.player = 10000;
  poor.advance(1440 * 3); rich.advance(1440 * 3);
  for (let i = 0; i < 72; i++) split.advance(60);
  expect(open(poor.opp()).length).toBeGreaterThan(0);
  expect(rich.opp()).toEqual(poor.opp()); expect(split.opp()).toEqual(poor.opp());
  expect(poor.run((c, s) => inquire(c, s, 'ai'))).toEqual(rich.run((c, s) => inquire(c, s, 'ai')));
  expect(rich.opp()).toEqual(poor.opp());
});

it('C102: the regular route and the public inquiry lead to the same opportunity with the same facts', () => {
  const a = setup(), b = setup(), target = open(a.opp())[0];
  expect(target).toBeDefined();
  // A regular (three visits) buys at the player's shop and mentions the worry.
  for (const f of [a, b]) f.run(c => { (c.systems.patrons as PatronState).visits[target.npcId] = 3; });
  a.run((c, s) => {
    c.book.businesses.push({ id: 'my-shop', placeId: c.placeOf(target.npcId) } as never);
    opportunity.onShopEvent!(c, s, { npcId: target.npcId, businessId: 'my-shop', itemId: 'tea', price: 8, count: 1, result: 'purchased' });
  });
  expect(a.opp().worry?.oppId).toBe(target.id);
  const viaRegular = a.run((c, s) => askWorry(c, s));
  const viaInquiry = b.run((c, s) => inquire(c, s, 'ai'))!;
  expect(viaInquiry.id).toBe(target.id); expect(viaInquiry.known).toBe(0);
  expect(() => b.run((c, s) => answer(c, s, target.id, true))).toThrow(); // two questions first
  b.run((c, s) => askQuestion(c, s, target.id)); b.run((c, s) => askQuestion(c, s, target.id));
  const strip = (o: typeof viaRegular) => ({ ...o, via: null, status: null });
  expect(strip(b.opp().opps.find(o => o.id === target.id)!)).toEqual(strip(viaRegular));
  expect(a.run((c, s) => answer(c, s, target.id, true)).status).toBe('accepted');
});

it('C102: at most three offers are shown; decline and expiry transitions; save and reload', () => {
  const f = setup();
  f.advance(1440 * 2);
  expect(open(f.opp()).length).toBeGreaterThan(maxShown);
  for (let i = 0; i < maxShown; i++) f.run((c, s) => inquire(c, s, 'ai'));
  expect(() => f.run((c, s) => inquire(c, s, 'ai'))).toThrow();
  expect(shown(f.opp())).toHaveLength(maxShown);
  const [declined, kept] = shown(f.opp());
  f.run((c, s) => answer(c, s, declined.id, false));
  expect(f.opp().opps.find(o => o.id === declined.id)!.status).toBe('declined');
  expect(() => f.run((c, s) => answer(c, s, declined.id, true))).toThrow();
  const restored = setup(undefined, f.data);
  expect(restored.session.loadResult.ok).toBe(true); expect(restored.opp()).toEqual(f.opp());
  restored.advance(1440 * opportunities[0].lifeDays);
  expect(restored.opp().opps.find(o => o.id === kept.id)!.status).toBe('expired');
  expect(shown(restored.opp())).toHaveLength(0);
});
