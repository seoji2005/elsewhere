import { Color, SRGBColorSpace } from 'three';

// docs/look/STYLE.md §2 as one keyframe table (R018: SEASON's single time-of-day table). Albedo never changes with
// the time; ?time=day|dusk|night are the three keys and ?time=0..2 blends between them (0 day, 1 dusk, 2 night).
// sky: top, band, bottom (= fog). fill: hemisphere power; its colours come from the sky (top above, bottom x0.6 below).
// Night: STYLE's moon x0.4 left warm albedos black in shade (§9-3), so moon x1.2 and a strong sky fill.
// shade: shade/lit ratio as seen on screen, shared by the city cel and MToon. bloom: HDR threshold (99 = none by day).
const keys = [
  { sky: ['#8fcdef', '#bfe2f0', '#dcdfd4'], glow: '#fff0c8', sun: '#fff0d9', power: 3.2, elevation: 36, fill: 1.7,
    shade: [0.8, 0.8, 0.86], ink: '#2a1c1c', band: 0.35, windows: 0.25, bloom: 99, clouds: '#ffffff' },
  { sky: ['#7a68b4', '#f4a7a2', '#f4c8a8'], glow: '#ff9a52', sun: '#ffaa70', power: 3, elevation: 10, fill: 1.7,
    shade: [0.58, 0.6, 0.86], ink: '#2a1a26', band: 1, windows: 1.6, bloom: 1.4, clouds: '#ffc6b4' },
  { sky: ['#121d38', '#2a3150', '#3c415c'], glow: '#000000', sun: '#8c94d0', power: 1.2, elevation: 40, fill: 12,
    shade: [0.5, 0.5, 0.72], ink: '#1a1426', band: 0, windows: 2, bloom: 1.4, clouds: '#3c4466' },
];
const asked = new URLSearchParams(location.search).get('time') ?? '';
const key = ['day', 'dusk', 'night'].indexOf(asked), t = Math.min(2, Math.max(0, key >= 0 ? key : Number(asked) || 0));
const [a, b, f] = [keys[Math.min(1, Math.floor(t))], keys[Math.min(2, Math.floor(t) + 1)], t - Math.min(1, Math.floor(t))];
const mix = (x: number, y: number) => x + (y - x) * f, color = (x: string, y: string) => new Color(x).lerp(new Color(y), f);
// The anime grade adds 15 % saturation in sRGB (duskLUT NEUTRAL); sky and fog take it back so they land on §2's hex.
function ungraded(c: Color) {
  const s = c.getRGB(new Color(), SRGBColorSpace), luma = 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b;
  return new Color().setRGB(...([s.r, s.g, s.b].map(v => luma + (v - luma) / 1.15) as [number, number, number]), SRGBColorSpace);
}
export const time = t < 0.5 ? 'day' : t < 1.5 ? 'dusk' : 'night';
const sky = a.sky.map((c, i) => ungraded(color(c, b.sky[i])));
export const tone = { sky, glow: color(a.glow, b.glow), sun: color(a.sun, b.sun), power: mix(a.power, b.power),
  elevation: mix(a.elevation, b.elevation), fill: [sky[0], sky[2].clone().multiplyScalar(0.6)], fillPower: mix(a.fill, b.fill),
  shade: new Color().setRGB(...(a.shade.map((v, i) => mix(v, b.shade[i])) as [number, number, number]), SRGBColorSpace),
  ink: color(a.ink, b.ink), band: mix(a.band, b.band), windows: mix(a.windows, b.windows), bloom: mix(a.bloom, b.bloom),
  clouds: color(a.clouds, b.clouds) };

// §7 inspection presets (?spot=A..E): player x, z and facing; camera eye and aim (sidewalks are 0.11 m up). The corner
// has no residential lane, plaza, river or rooftop yet, so each is the nearest view in today's corner (temporary).
type V3 = [number, number, number];
export const spots: Record<string, { at: V3; eye: V3; aim: V3 }> = {
  A: { at: [-27.3, -7, -Math.PI / 2], eye: [-31.8, 1.31, -6], aim: [0, 3, -4.2] }, // S1 sidewalk, 1.2 m, 3° up
  B: { at: [-6.6, 0.5, Math.PI], eye: [-3.2, 1.6, 2.8], aim: [-8.5, 0.97, -2] }, // S2 zebra crossing, 1.6 m, 5° down
  C: { at: [-1.5, -3.2, Math.PI / 2], eye: [4, 1.5, -2.5], aim: [-60, 3.7, -4.5] }, // S5 street canyon, 1.5 m, 2° up
  D: { at: [22.5, 19.5, -2.28], eye: [26, 1.51, 22], aim: [-30, 1.51, -26] }, // S4 open lot to the skyline, level
  E: { at: [-7, -6, 0], eye: [-2, 13, 2], aim: [-30, 5.95, -27] }, // S3 12 m up, 10° down
  // ?town=1 (C077): T1 the south row (조율실, 교환소, 찻방) from the far sidewalk, T2 the north row (뜰, 공동집, 두 집),
  // T3 떠오름 뜰 from the crossing.
  T1: { at: [-27.5, -6.4, 0.3], eye: [-18, 1.6, 4.4], aim: [-33, 3.4, -9.5] },
  T2: { at: [-30, 6.4, Math.PI], eye: [-24, 1.6, -7.6], aim: [-34.5, 3.6, 9.5] },
  T3: { at: [-14.5, 8.6, 2.6], eye: [-7.4, 1.7, 6.6], aim: [-19, 2, 19] },
};
