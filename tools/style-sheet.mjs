// STYLE.md §9 contact sheet: node tools/style-sheet.mjs [shots dir=.shots-gha] [out=<dir>/style-sheet.png]
// Takes the gha-shots results (spot=A..E x time=day|dusk|night, then the dialogue shot), lays them out 4 per row as
// 300 px thumbnails with labels, and runs the two automatic §9 checks on every full-size shot:
//  3. pure black: share of pixels with R+G+B < 30 must stay under 0.1 %.
//  6. sky: ΔE (CIE76) against §2 of the closest flat (luma spread < 3) 32x16 patch: "sky top" within the top 20 % of the
//     frame, "sky bottom" (= fog: horizon or fogged far façades) within the upper 65 %; HUD bar (x > 430, y < 50) excluded; both < 12.
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.shots-gha', out = process.argv[3] ?? join(dir, 'style-sheet.png');
const SKY = { day: ['#8fcdef', '#dcdfd4'], dusk: ['#7a68b4', '#f4c8a8'], night: ['#121d38', '#3c415c'] };
const TIMES = Object.keys(SKY);
const files = readdirSync(dir).filter(f => /^phone.*\.(jpe?g|png)$/.test(f));
const timeOf = f => /time=(day|dusk|night)/.exec(f)?.[1] ?? 'day';
const rank = f => {
  const spot = /spot=([A-E])/.exec(f)?.[1];
  return spot ? 'ABCDE'.indexOf(spot) * 3 + TIMES.indexOf(timeOf(f)) : /talk=/.test(f) ? 15 : 16;
};
files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
if (!files.length) throw Error(`No phone*.jpg shots in ${dir}`);

const lab = rgb => {
  const [r, g, b] = rgb.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// Closest flat 32x16 window (8 px steps) above y1, outside the HUD bar.
function closest({ data, info }, y1, target) {
  const list = [];
  for (let y = 0; y + 16 <= y1; y += 8) for (let x = 0; x + 32 <= info.width; x += 8) {
    if (x + 32 > 430 && y < 50) continue;
    const sum = [0, 0, 0]; let l1 = 0, l2 = 0;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 32; i++) {
      const k = ((y + j) * info.width + x + i) * info.channels, luma = 0.3 * data[k] + 0.59 * data[k + 1] + 0.11 * data[k + 2];
      for (let c = 0; c < 3; c++) sum[c] += data[k + c];
      l1 += luma; l2 += luma * luma;
    }
    if (Math.sqrt(Math.max(0, l2 / 512 - (l1 / 512) ** 2)) < 3) list.push(deltaE(sum.map(v => v / 512), hex(target)));
  }
  return Math.min(...list);
}

const rows = [], thumbs = [];
for (const file of files) {
  const image = await sharp(join(dir, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = image, time = timeOf(file);
  let black = 0;
  for (let k = 0; k < data.length; k += info.channels) if (data[k] + data[k + 1] + data[k + 2] < 30) black++;
  const row = { file, black: 100 * black / (info.width * info.height),
    top: closest(image, Math.round(info.height * 0.2), SKY[time][0]), bottom: closest(image, Math.round(info.height * 0.65), SKY[time][1]) };
  rows.push(row);
  const label = `${file.replace(/^phone_?|\.jpe?g$/g, '').replace(/_/g, ' ')}  blk ${row.black.toFixed(2)}%  sky ${row.top.toFixed(0)}/${
    row.bottom.toFixed(0)}`;
  const svg = `<svg width="300" height="18"><rect width="300" height="18" fill="#1b1b1f"/><text x="4" y="13" font-family="sans-serif"
    font-size="11" fill="#e8e2d6">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  thumbs.push({ shot: await sharp(join(dir, file)).resize(300).png().toBuffer(), label: Buffer.from(svg) });
}

const gap = 6, w = 300, h = Math.round(300 * 393 / 852) + 18, cols = 4, lines = Math.ceil(thumbs.length / cols);
await sharp({ create: { width: cols * (w + gap) + gap, height: lines * (h + gap) + gap, channels: 3, background: '#2a2a30' } })
  .composite(thumbs.flatMap((t, i) => {
    const left = gap + (i % cols) * (w + gap), top = gap + Math.floor(i / cols) * (h + gap);
    return [{ input: t.shot, left, top }, { input: t.label, left, top: top + h - 18 }];
  })).png().toFile(out);

console.log('shot | black % (<0.1) | sky top ΔE (<12) | sky bottom ΔE (<12)');
for (const r of rows) console.log(`${r.file} | ${r.black.toFixed(3)} | ${r.top.toFixed(1)} | ${r.bottom.toFixed(1)}`);
const sky = rows.filter(r => /spot=/.test(r.file));
console.log(`§9-3 black: ${rows.every(r => r.black < 0.1) ? 'PASS' : 'FAIL'} (max ${Math.max(...rows.map(r => r.black)).toFixed(3)} %)`);
console.log(`§9-6 sky: ${sky.length && sky.every(r => r.top < 12 && r.bottom < 12) ? 'PASS' : 'FAIL'} (spot shots; worst top ${
  Math.max(...sky.map(r => r.top)).toFixed(1)}, bottom ${Math.max(...sky.map(r => r.bottom)).toFixed(1)})`);
console.log(`Sheet: ${out}`);
