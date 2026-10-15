import { pathToFileURL } from 'node:url';

// Same paid capital, seed and real session loop for every policy; no wallet injection.
// 게으름: 직원/차 24개 후 방치. 보통: 혼자 09~12시/품목당 6개. 잘함: 직원/품목당 20개(배송 중 포함).
export function runPolicy(createSession, { transfer, gameTime, emptyBond, edgeKey }, policy, seed = 123, bad = 'missing', newGame = false) {
  // newGame (C107): a brand-new game's conditions — delivery fees and the city's starting ledger (createSession's 5th argument).
  const session = createSession({ getItem: () => null, setItem: () => {} }, seed, undefined, newGame ? 2 : 1, newGame), { state } = session;
  const ledger = state.world.ledger, total = () => Object.values(ledger.balances).reduce((a, b) => a + b, 0);
  const initial = total(), advance = minutes => session.tick(minutes / state.world.clock.minutesPerSecond);
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) {
    if (!transfer(ledger, { id: `capital:${from}`, from, to: 'player', amount: 300,
      time: gameTime(state.world.clock), reason: 'Capital transfer' }).ok) throw Error('Capital unavailable');
  }
  const lease = session.rentStore('cafe-unit'), business = session.openShop('tea');
  if (policy !== '보통') {
    state.bonds.edges[edgeKey('velo', 'player')] = { ...emptyBond(), trust: 30, respect: 20, met: true };
    if (!session.offerJob('velo', 4).accepted) throw Error('Hiring failed');
  }
  const wallet = () => ({ affordable: Object.keys(state.purses).filter(id => id !== 'player' &&
    ledger.balances[id] - state.purses[id].reserve >= 8).length,
    spendable: Object.keys(state.purses).filter(id => id !== 'player').reduce((n, id) => n + Math.max(0, ledger.balances[id] - state.purses[id].reserve), 0) });
  const startWallet = wallet(), daily = [];
  for (let day = 1; day <= 30; day++) {
    const before = ledger.balances.player;
    for (const stock of business.store.stock) {
      const lazy = policy === '게으름', target = lazy && bad === 'missing' ? (day === 1 && stock.itemId === 'tea' ? 24 : 0) : policy === '보통' ? 6 : 20;
      const pending = lease.orders.filter(o => !o.delivered && o.itemId === stock.itemId).reduce((n, o) => n + o.quantity, 0);
      const quantity = Math.max(0, target - stock.backroom - stock.displayed - pending);
      if (quantity && !session.orderStock(stock.itemId === 'soup' ? 'iri' : 'nuel', stock.itemId, quantity).ok) throw Error('Order failed');
      session.setShopPrice(stock.itemId, lazy && bad === 'expensive' ? 1000 : lazy && bad === 'below-cost' ? 1 : stock.price);
    }
    if (policy === '보통') {
      advance(540); state.player.placeId = 'cafe'; advance(180); state.player.placeId = 'nest'; advance(720);
    } else advance(1440);
    if (total() !== initial) throw Error(`Money changed: ${policy}/${day}`);
    const report = { ...lease.reports.at(-1), ...wallet(), purse: ledger.balances.player - before };
    report.cumulative = (daily.at(-1)?.cumulative ?? 0) + report.net;
    daily.push(report);
  }
  const sum = key => daily.reduce((n, r) => n + r[key], 0);
  return { policy, seed, daily, initial, total: total(), deposit: 40, startWallet, endWallet: wallet(),
    reputation: state.reputation.player, ended: lease.ended, breakEven: daily.find(r => r.cumulative >= 0)?.day ?? null,
    visits: sum('visits'), sales: sum('sales'), revenue: sum('revenue'), cost: sum('cost'), rent: sum('rent'), wages: sum('wages'), net: sum('net') };
}

// C114 (REVIEW-economy-20261016): a new game with no extra capital; '혼자' sells 09–12, '직원' sells alone for 7 days,
// then trials and hires the first applicant on day 8 and leaves the counter; '알바만' works 물건 정리 2h + 찻방 1h a day.
// Stock: 6 per item, carried by hand at 08:00 keeping 6 cash. Daily net = wallet change (deposit excluded) − change in unpaid staff wages.
export function runEconomy(createSession, { haul, staff, producerJobs }, mode, seed) {
  const session = createSession({ getItem: () => null, setItem: () => {} }, seed, undefined, 2, true), { state } = session;
  const ledger = state.world.ledger, total = () => Object.values(ledger.balances).reduce((a, b) => a + b, 0), initial = total();
  const advanceTo = minute => session.tick((minute - state.world.clock.totalMinutes) / state.world.clock.minutesPerSecond);
  const go = placeId => { state.player.placeId = placeId; state.world.people.player.placeId = placeId; };
  const owed = () => Object.values(state.tycoon.systems.staff?.people ?? {}).reduce((n, p) => n + (p.pay?.owed ?? 0), 0);
  const shop = mode === '알바만' ? null : (session.rentStore('cafe-unit'), session.openShop('tea'));
  const daily = []; let balance = ledger.balances.player, unpaid = 0, hired = null;
  for (let day = 1; day <= 30; day++) {
    const start = (day - 1) * 1440;
    if (shop) {
      advanceTo(start + 480);
      for (const stock of shop.store.stock) {
        const producer = session.tycoon.ctx().residents.find(n => n.job === producerJobs[stock.itemId]), unit = haul.unitCost(stock.itemId);
        const qty = Math.min(6 - stock.backroom - stock.displayed, haul.CARRY_LIMIT, Math.floor((ledger.balances.player - 6) / unit));
        if (!producer || qty < 1) continue;
        go(session.tycoon.ctx().placeOf(producer.id));
        if (session.tycoon.command('haul', (c, h) => haul.pickupOrder(c, h, producer.id, stock.itemId, qty)).ok) {
          go(shop.placeId); session.tycoon.command('haul', (c, h) => haul.dropAtShop(c, h));
        }
      }
      go('nest'); advanceTo(start + 540);
      if (mode === '혼자' || day < 8) { go(shop.placeId); advanceTo(start + 720); go('nest'); }
      else if (day === 8) {
        go(shop.placeId); const who = staff.applicants(session.tycoon.ctx())[0]?.npc.id;
        if (who && !session.tycoon.command('staff', (c, x) => staff.startTrial(c, x, who))) {
          go('nest'); const st = state.tycoon.systems.staff;
          while (st.trial?.status === 'running' && state.world.clock.totalMinutes < start + 1000) session.tick(1);
          go(shop.placeId); if (session.tycoon.command('staff', (c, x) => staff.hireTrial(c, x))) hired = who;
        }
        go('nest');
      }
    } else {
      advanceTo(start + 480); go('shop'); session.startWork('exchange-helper'); advanceTo(start + 600);
      go('cafe'); session.startWork('tea-helper'); advanceTo(start + 660); go('nest');
    }
    advanceTo(day * 1440 + 1);
    if (total() !== initial) throw Error(`Money changed: ${mode}/${day}`);
    const now = owed(), purse = ledger.balances.player - balance;
    daily.push({ day, purse, owed: now, net: purse - (now - unpaid) }); balance = ledger.balances.player; unpaid = now;
  }
  const left = hired && state.book.employment.find(e => e.actorId === hired)?.leftAt;
  return { mode, seed, daily, net: daily.reduce((n, d) => n + d.net, 0), owed: unpaid, quit: left != null ? Math.floor(left / 1440) + 1 : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, cacheDir: '/tmp/c087-vite', server: { middlewareMode: true, ws: false }, appType: 'custom' });
  try {
    const [{ createSession }, ledger, clock, bonds] = await Promise.all([
      server.ssrLoadModule('/src/game/session.ts'), server.ssrLoadModule('/src/sim/ledger.ts'),
      server.ssrLoadModule('/src/sim/clock.ts'), server.ssrLoadModule('/src/sim/bonds.ts')]);
    const deps = { ...ledger, ...clock, ...bonds }, newGame = process.argv.includes('--new-game');
    if (process.argv.includes('--economy')) { // C114: 혼자·직원·알바만 30일, 새 게임 시드 0·1·123
      const [haul, staff, { producerJobs }] = await Promise.all(['/src/game/tycoon/haul.ts', '/src/game/tycoon/staff.ts', '/src/sim/business.ts'].map(m => server.ssrLoadModule(m)));
      const avg = (r, from, to) => +(r.daily.slice(from, to).reduce((n, d) => n + d.net, 0) / (to - from)).toFixed(2);
      console.table([0, 1, 123].map(seed => {
        const [solo, hire, job] = ['혼자', '직원', '알바만'].map(mode => runEconomy(createSession, { haul, staff, producerJobs }, mode, seed));
        return { 시드: seed, '혼자 첫 주/일': avg(solo, 0, 7), '혼자 30일': solo.net, '직원 8~14일/일': avg(hire, 7, 14), '직원 22~30일/일': avg(hire, 21, 30),
          '직원 30일': hire.net, '직원 미지급': hire.owed, '직원 퇴사일': hire.quit ?? '-', '알바만 30일': job.net, '알바 3시간 < 혼자': avg(job, 0, 30) < avg(solo, 0, 30) };
      }));
      process.exit(0);
    }
    if (process.argv.includes('--weeks')) { // C107: 보통 운영 주별 하루 평균 순이익(보고서 = 지갑 증감), 시드 0·1·123
      const avg = (r, from, to) => +(r.daily.slice(from, to).reduce((n, d) => n + d.net, 0) / (to - from)).toFixed(2);
      console.table([0, 1, 123].map(seed => runPolicy(createSession, deps, '보통', seed, 'missing', newGame)).map(r => ({ 시드: r.seed,
        '1주': avg(r, 0, 7), '2주': avg(r, 7, 14), '3주': avg(r, 14, 21), '22~30일': avg(r, 21, 30), '30일 합계': r.net,
        '지갑 증감': r.daily.reduce((n, d) => n + d.purse, 0), 전체결: `${r.initial}→${r.total}` })));
      process.exit(0);
    }
    const results = ['게으름', '보통', '잘함'].map(policy => runPolicy(createSession, deps, policy, 123, 'missing', newGame));
    console.table(results.map(r => ({ 정책: r.policy, 방문: r.visits, 판매: r.sales, 객단가: +(r.revenue / (r.sales || 1)).toFixed(2),
      매출: r.revenue, 원가: r.cost, 임대료: r.rent, 임금: r.wages, 순이익: r.net,
      구매가능주민: `${r.startWallet.affordable}→${r.endWallet.affordable}`, 주민가용결: `${r.startWallet.spendable}→${r.endWallet.spendable}`, 평판: r.reputation, 전체결: `${r.initial}→${r.total}` })));
    console.table(Array.from({ length: 30 }, (_, i) => Object.fromEntries([['일', i + 1], ...results.flatMap(r =>
      [[`${r.policy} 순이익`, r.daily[i].net], [`${r.policy} 누적`, r.daily[i].cumulative]])])));
    if (process.argv.includes('--json')) console.log(JSON.stringify(results));
  } finally { await server.close(); }
}
