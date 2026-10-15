// Where residents live out their day on the corner street (C083): feet position x, z (sidewalk top y), facing yaw,
// the action and the sim places (data/places) whose residents take the spot. Measured from scene/props.ts.
export interface LifeSpot {
  kind: 'sit' | 'buy' | 'talk';
  places: readonly string[];
  x: number; z: number; yaw: number;
  seat?: number; // seat top above the sidewalk (m)
}
export const sidewalk = 0.11;
// The bench in front of the exchange stands in for 떠오름 뜰 and the 찻방's outdoor seats until those places are built:
// seat top 0.542, seat z -6.95..-6.66 with the backrest toward the wall, two places side by side.
const bench = { kind: 'sit', places: ['park', 'cafe'], z: -6.8, yaw: 0, seat: 0.542 - sidewalk } as const;
export const lifeSpots: readonly LifeSpot[] = [
  { ...bench, x: -20.55 },
  { ...bench, x: -19.85 },
  // In front of the exchange's door (data/doors shop-front), facing its shopfront.
  { kind: 'buy', places: ['shop'], x: -18.7, z: -6.5, yaw: Math.PI },
  // A chat on the open sidewalk between a stoop and the planter: three places facing a common centre.
  { kind: 'talk', places: [], x: -26.95, z: -6.3, yaw: Math.PI / 2 },
  { kind: 'talk', places: [], x: -26.05, z: -6.3, yaw: -Math.PI / 2 },
  { kind: 'talk', places: [], x: -26.5, z: -6.9, yaw: 0 },
];
