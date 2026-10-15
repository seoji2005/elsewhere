// Generate images with the Gemini API (run on GitHub Actions; the key comes from the
// GEMINI_API_KEY secret). Request: { model?, prefix?, items: [{ id, prompt, n? }] }.
// Writes <out>/<id>-<k>.png and <out>/index.json (id, file, prompt, model).
// Cost (user 2026-10-15: 15,000 KRW went on 71 pro images): candidates use flash; spec.quality = 'pro' for finals.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const [req, out] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY secret is missing'); process.exit(1); }
const spec = JSON.parse(readFileSync(req, 'utf8'));
const api = 'https://generativelanguage.googleapis.com/v1beta';
async function pickModel() {
  if (spec.model) return spec.model;
  const list = await (await fetch(`${api}/models?key=${key}&pageSize=200`)).json();
  const names = (list.models ?? []).map(m => m.name.replace('models/', ''));
  const image = names.filter(n => /image/.test(n) && /gemini/.test(n));
  console.log('image-capable models:', image.join(', '));
  const tier = spec.quality === 'pro' ? /pro/ : /flash/;
  return image.find(n => tier.test(n)) ?? image[0] ?? 'gemini-2.5-flash-image';
}
mkdirSync(out, { recursive: true });
const model = await pickModel();
const index = [];
outer: for (const item of spec.items) {
  for (let k = 1; k <= (item.n ?? 1); k++) {
    const prompt = [spec.prefix, item.prompt].filter(Boolean).join('\n\n');
    const res = await fetch(`${api}/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], ...(spec.aspect ? { imageConfig: { aspectRatio: spec.aspect } } : {}) } }),
    });
    const body = await res.json();
    const part = body.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) {
      console.log(`${item.id}-${k}: no image`, res.status, JSON.stringify(body.error ?? body.promptFeedback ?? {}).slice(0, 300));
      if (res.status === 402 || res.status === 429) break outer; // credits gone: stop instead of repeating the error
      continue;
    }
    const file = `${item.id}-${k}.png`;
    writeFileSync(`${out}/${file}`, Buffer.from(part.inlineData.data, 'base64'));
    index.push({ id: item.id, file, prompt: item.prompt, model });
    console.log('ok', file);
  }
}
writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 2));
// List prices per image (USD, 1K-2K output): pro 0.134, flash 0.039.
const usd = index.length * (/pro/.test(model) ? 0.134 : 0.039);
console.log(`model ${model}: ${index.length} images, est. $${usd.toFixed(2)}`);
