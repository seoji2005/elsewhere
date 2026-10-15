// Play scenario: on a phone-sized touch page, push the left-thumb joystick lightly (walk), then fully (run).
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
  await page.goto(distURL);
  await page.locator('canvas[data-ready="true"]').waitFor();
  const start = await page.evaluate(() => window.cornerDiagnostics().player);
  // Real touch input through CDP so the page sees pointerType "touch", like a phone.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y = 300) => cdp.send('Input.dispatchTouchEvent',
    { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 110, y }] });
  await touch('touchStart');
  for (let step = 1; step <= 4; step++) await touch('touchMove', 300 - step * 10); // light push = walk
  await page.waitForFunction(([x, , z]) => {
    const { player } = window.cornerDiagnostics();
    return Math.hypot(player[0] - x, player[2] - z) > 0.4;
  }, start, { polling: 500 });
  const walking = await page.evaluate(() => window.cornerDiagnostics().speed);
  await touch('touchMove', 220); // thumb to the outer ring = run
  await page.waitForFunction(() => window.cornerDiagnostics().speed > 3, null, { polling: 500 });
  await touch('touchEnd');
  const end = await page.evaluate(() => window.cornerDiagnostics().player);
  console.log(`Play: joystick moved player ${Math.hypot(end[0] - start[0], end[2] - start[2]).toFixed(2)}m`
    + ` at ${walking.toFixed(2)}m/s`);
  if (!(walking > 0.3 && walking < 2)) errors.push(`Light push should walk, got ${walking}m/s`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
