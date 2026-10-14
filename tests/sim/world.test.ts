import { expect, it } from 'vitest';
import { createWorld } from '../../src/sim/world';

it('stores people, places, companies by ID and directional relationships without rules', () => {
  const world = createWorld();
  world.places.home = { id: 'home', name: 'Home' };
  world.people.player = { id: 'player', name: 'Player', role: 'player', placeId: 'home' };
  world.people.neighbor = { id: 'neighbor', name: 'Neighbor', role: 'npc', placeId: 'home' };
  world.companies.shop = { id: 'shop', name: 'Shop' };
  world.relationships.player = { neighbor: 12 };
  world.relationships.neighbor = { player: -2 };
  expect(world.people.neighbor.role).toBe('npc');
  expect(world.places[world.people.player.placeId].name).toBe('Home');
  expect(world.companies.shop.name).toBe('Shop');
  expect(world.relationships).toEqual({ player: { neighbor: 12 }, neighbor: { player: -2 } });
  expect(createWorld().people).toEqual({});
});
