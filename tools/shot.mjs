import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { distURL } from './serve.mjs';

const args = process.argv.slice(2);
const queries = args.filter(arg => arg !== '--smoke');
if (!queries.length) queries.push('');
const captures = [];
mkdirSync('.shots', { recursive: true });
const requested = process.env.SHOT_GL ?? 'swiftshader';
if (!['swiftshader', 'vulkan'].includes(requested)) throw Error('SHOT_GL must be swiftshader or vulkan');
let backend = requested, browser;
async function launch(gl) {
  return chromium.launch({ args: ['--use-gl=angle', ...(gl === 'vulkan'
    ? ['--use-angle=vulkan', '--enable-features=Vulkan']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
}
try { browser = await launch(backend); }
catch (error) {
  if (backend !== 'vulkan') throw error;
  backend = 'swiftshader'; browser = await launch(backend);
}
const errors = [];
try {
  let page, previousQuery;
  async function newPage() {
    const next = await browser.newPage({
      viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true,
    });
    next.setDefaultTimeout(240_000);
    next.on('pageerror', error => errors.push(String(error)));
    next.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    return next;
  }
  page = await newPage();
  for (const query of queries) {
  const [search, cam] = query.split('@cam=');
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  params.set('shot', '1');
  const key = params.toString();
  const pose = cam === undefined ? undefined : cam.split(',').map(Number);
  if (pose && (pose.length !== 6 || !pose.every(Number.isFinite))) throw Error('Invalid @cam coordinates');
  if (process.env.SHOT_MODE === 'legacy') {
    await page.close(); page = await newPage(); previousQuery = undefined;
  }
  if (key !== previousQuery) {
    const url = distURL + '?' + key;
    try {
      await page.goto(url);
      await page.locator('canvas[data-ready="true"]').waitFor();
      if (errors.length) throw Error(errors.join('\n'));
    } catch (error) {
      if (backend !== 'vulkan') throw error;
      console.warn('Vulkan failed; falling back to swiftshader');
      await browser.close(); backend = 'swiftshader'; browser = await launch(backend);
      errors.length = 0; page = await newPage();
      await page.goto(url); await page.locator('canvas[data-ready="true"]').waitFor();
    }
    previousQuery = key;
  }
  await page.evaluate(p => p ? window.__shot.setCamera(p.slice(0, 3), p.slice(3)) : window.__shot.setCamera(), pose);
  await page.evaluate(() => window.__shot.frame());
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 85 });
  const filename = `phone${query ? '_' + query.replace(/[^a-zA-Z0-9=_-]/g, '_') : ''}.jpg`;
  writeFileSync('.shots/' + filename, jpeg);
  captures.push(`<figure><figcaption>${filename}</figcaption><img style="width:100%;display:block" src="data:image/jpeg;base64,${jpeg.toString('base64')}"></figure>`);
  }
  writeFileSync('.shots/sheet.html', `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>장면 확인</title>
<body style="margin:0">${captures.join('')}</body></html>`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Screenshot: .shots/sheet.html; GL=${backend}; no console errors`);
}
