import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const queries = args.filter(arg => arg !== '--smoke');
if (!queries.length) queries.push('');
const captures = [];
mkdirSync('.shots', { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true,
  });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const query of queries) {
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href + (query ? '?' + query.replace(/^\?/, '') : ''));
  // CPU (SwiftShader) rendering on the server is slow; allow a long first frame.
  page.setDefaultTimeout(240_000);
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
  console.log('Screenshot: .shots/phone.jpg, .shots/sheet.html; no console errors');
}
