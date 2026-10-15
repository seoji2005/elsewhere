import { expect, it } from 'vitest';
import { npcs } from '../../src/data/npcs';
import { items } from '../../src/data/items';
import { createLedger } from '../../src/sim/ledger';
import { createRelationshipState } from '../../src/sim/relationship';
import { createShopState, buyItem, useItem, giveGift } from '../../src/sim/shop';
import { createWorkState, startWork, finishWork } from '../../src/sim/work';
import { createWorld } from '../../src/sim/world';
const time = { day: 1, hour: 1, minute: 0 };

it('fails without funds and neither charges nor grants inventory twice on retries', () => {
  const state = createShopState();
  const ledger = createLedger({ player: 10, shop: 0 });
  expect(buyItem(state, ledger, 'poor', 'player', 'coat', time).ok).toBe(false);
  expect(state.residents).toEqual({});
  expect(buyItem(state, ledger, 'one', 'player', 'tea', time).ok).toBe(true);
  const restored = JSON.parse(JSON.stringify(state));
  expect(buyItem(restored, ledger, 'one', 'player', 'tea', time)).toEqual({ ok: true, duplicate: true });
  expect(buyItem(state, ledger, 'one', 'player', 'bread', time).ok).toBe(false);
  expect(ledger.balances).toEqual({ player: 2, shop: 8 });
  expect(restored.residents.player.inventory.tea).toBe(1);
  expect(ledger.transactions).toHaveLength(1);
});

it('applies food, clothing and decoration effects only to owned items', () => {
  expect(items).toHaveLength(8);
  const state = createShopState();
  const ledger = createLedger({ player: 300, shop: 0 });
  for (const id of ['soup', 'scarf', 'coat', 'lamp']) {
    buyItem(state, ledger, id, 'player', id, time);
    useItem(state, 'player', id);
  }
  const life = state.residents.player;
  expect(life.energy).toBe(90);
  expect(life.appearance).toBe(7);
  expect(life.inventory.scarf).toBe(1);
  expect(life.atmosphere).toBe(5);
  expect(life.decorations).toEqual(['lamp']);
  expect(() => useItem(state, 'player', 'soup')).toThrow();
});

it('spends the first wage on a gift and changes the existing world relationship by taste', () => {
  const world = createWorld();
  world.ledger = createLedger({ player: 0, cafe: 100, shop: 0 });
  const work = createWorkState();
  // C114: 찻방 시급 30→2결. 등(30결)을 사려면 첫 근무 하나로는 모자라 15번 근무한다.
  for (let hour = 0; hour < 15; hour++) {
    const shift = startWork(work, 'player', 'tea-helper', 'cafe', { ...time, hour });
    finishWork(work, world.ledger, shift.id, { ...time, hour: hour + 1 });
  }
  const state = createShopState();
  const relationships = createRelationshipState();
  buyItem(state, world.ledger, 'gift', 'player', 'lamp', time);
  expect(giveGift(state, world, relationships, 'player', npcs[0], 'lamp', time).change).toBe(7);
  expect(world.relationships.player.aro).toBe(7);
  expect(world.ledger.balances.player).toBe(0);
  expect(() => giveGift(state, world, relationships, 'player', npcs[0], 'lamp', time)).toThrow();
  const other = createShopState();
  const ledger = createLedger({ player: 100, shop: 0 });
  for (let i = 0; i < 3; i++) buyItem(other, ledger, `tea${i}`, 'player', 'tea', time);
  const liked = giveGift(other, world, relationships, 'player', npcs[1], 'tea', time);
  const neutral = giveGift(other, world, relationships, 'player', npcs[0], 'tea', time);
  expect(liked.change).toBeGreaterThan(neutral.change);
  expect(giveGift(other, world, relationships, 'player', npcs[1], 'tea', time).change).toBe(3);
});
