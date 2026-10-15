import { companies, companyJobs } from '../data/companies';
import { transfer, type LedgerState } from './ledger';
import type { GameTime } from './clock';

export interface MarketEvent { companyId: string; size: number; days: number }
export interface MarketHint extends MarketEvent { dueDay: number }
export interface MarketState {
  hints?: MarketHint[];
  seed: number; day: number; prices: Record<string, number>; events: MarketEvent[];
  revenue: Record<string, number>; holdings: Record<string, Record<string, number>>;
}
const known = (id: string) => companies.some(company => company.id === id);
export function createMarket(seed = 1): MarketState {
  const market: MarketState = { seed: seed >>> 0, day: 1, prices: Object.fromEntries(companies.map(c => [c.id, c.basePrice])),
    events: [], revenue: {}, holdings: {} };
  scheduleEvents(market);
  return market;
}
// Event size and revenue change are signed fractions (0.1 means +10%).
export function applyEvent(market: MarketState, event: MarketEvent): void {
  if (!known(event.companyId) || !Number.isFinite(event.size) ||
      !Number.isSafeInteger(event.days) || event.days < 1) throw Error('Invalid market event');
  market.events.push({ ...event });
}
// Keep one seeded future event per company; retain pending schedules from older saves.
function scheduleEvents(market: MarketState): void {
  for (const [index, company] of companies.entries()) {
    if (market.hints?.some(hint => hint.companyId === company.id)) continue;
    const roll = (Math.imul(market.seed ^ market.day, 1664525) + 1013904223 + index) >>> 0;
    (market.hints ??= []).push({ companyId: company.id, size: roll % 2 ? 0.08 : -0.08,
      days: 2, dueDay: market.day + 4 + roll % 7 });
  }
}
export function revealMarketHint(market: MarketState, job: string): MarketHint | undefined {
  return market.hints?.find(hint => hint.companyId === companyJobs[job]
    && hint.dueDay > market.day && hint.dueDay <= market.day + 3);
}
export function recordNpcRevenue(market: MarketState, npcId: string, change: number): void {
  const company = companies.find(c => c.npcId === npcId);
  if (!company || !Number.isFinite(change)) throw Error('Invalid NPC revenue');
  const total = (market.revenue[company.id] ?? 0) + change;
  if (!Number.isFinite(total)) throw Error('Revenue overflow');
  market.revenue[company.id] = total;
}
export function advanceDay(market: MarketState): void {
  scheduleEvents(market);
  for (const hint of market.hints ?? []) if (hint.dueDay <= market.day + 1) {
    applyEvent(market, { companyId: hint.companyId, size: hint.size, days: hint.days });
  }
  if (market.hints) market.hints = market.hints.filter(hint => hint.dueDay > market.day + 1);
  for (const company of companies) {
    market.seed = (Math.imul(market.seed, 1664525) + 1013904223) >>> 0;
    const noise = (market.seed / 4294967296 * 2 - 1) * company.volatility;
    const shock = market.events.filter(e => e.companyId === company.id).reduce((sum, e) => sum + e.size, 0);
    const change = noise + shock + (market.revenue[company.id] ?? 0) * 0.1;
    market.prices[company.id] = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER,
      Math.round(market.prices[company.id] * (1 + change))));
  }
  market.events = market.events.map(e => ({ ...e, days: e.days - 1 })).filter(e => e.days > 0);
  market.revenue = {};
  market.day++;
  scheduleEvents(market);
}
export interface Trade {
  id: string; time: GameTime; account: string; companyId: string; quantity: number; side: 'buy' | 'sell';
}
// The caller funds a distinct market account; all settlement, including fees, uses one transfer.
export function trade(market: MarketState, ledger: LedgerState, order: Trade, marketAccount = 'market') {
  const { id, time, account, companyId, quantity, side } = order;
  const held = Object.hasOwn(market.holdings, account) ? market.holdings[account][companyId] ?? 0 : 0;
  if (!id || !known(companyId) || !Number.isSafeInteger(quantity) || quantity <= 0 ||
      (side !== 'buy' && side !== 'sell') || account === marketAccount ||
      (side === 'sell' && quantity > held) || (side === 'buy' && !Number.isSafeInteger(held + quantity))) {
    return { ok: false, error: 'Invalid trade' };
  }
  const gross = market.prices[companyId] * quantity;
  const fee = Math.ceil(gross / 100);
  const amount = side === 'buy' ? gross + fee : gross - fee;
  if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(amount) || amount <= 0 ||
      ledger.transactions.some(entry => entry.id === id)) return { ok: false, error: 'Invalid settlement' };
  const result = transfer(ledger, { id, time, from: side === 'buy' ? account : marketAccount,
    to: side === 'buy' ? marketAccount : account, amount, reason: `${side}:${companyId}:fee=${fee}` });
  if (result.ok && !result.duplicate) {
    if (!Object.hasOwn(market.holdings, account)) {
      Object.defineProperty(market.holdings, account, { value: {}, enumerable: true, writable: true, configurable: true });
    }
    market.holdings[account][companyId] = held + (side === 'buy' ? quantity : -quantity);
  }
  return result;
}
