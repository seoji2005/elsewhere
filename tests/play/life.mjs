// Play scenario (C083): open the street with its residents by day; they sit on the bench, buy at the exchange and chat,
// and keep doing so while the user watches.
import { chromium } from 'playwright';
import { distURL } from '../../tools/serve.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(240_000); // SwiftShader renders about one frame per second
  await page.goto(new URL('?cast=1&time=day', distURL).href);
  await page.locator('canvas[data-ready="true"]').waitFor();
  const count = (life, kind) => life.filter(activity => activity === kind).length;
  const first = await page.evaluate(() => window.cornerDiagnostics().life);
  await page.waitForTimeout(5000); // a few frames later nobody has dropped back to plain standing
  const later = await page.evaluate(() => window.cornerDiagnostics().life);
  console.log(`Play: residents ${later.join(', ')}`);
  if (count(first, 'sit') < 1 || count(first, 'buy') < 1 || count(first, 'talk') < 2)
    errors.push(`Expected a bench sitter, a buyer and a chatting pair, got ${first}`);
  if (later.join() !== first.join()) errors.push(`Residents changed what they do: ${first} -> ${later}`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
