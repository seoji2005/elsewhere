// from research R001
import { WebGLRenderer } from 'three';

// Call sample(raw RAF delta in seconds); simulation-clamped delta hides stalls.
// Quality ladder: when fps < 50, apply the next cheaper step (effects first, in the given order),
// then lower the pixel ratio toward minDpr; at fps >= 58 undo the last step. Sharpness goes last.
export function adaptiveResolution(renderer: WebGLRenderer,
  maxDpr = Math.min(window.devicePixelRatio || 1, 2), // user phone: 2.5x = 55fps, 2x = stable 60 (shadow lookups scale with pixels)
  onResize?: (dpr: number, width: number, height: number) => void,
  steps: ((cheaper: boolean) => void)[] = [], minDpr = Math.min(1.6, maxDpr)) {
  if (!(maxDpr > 0 && Number.isFinite(maxDpr) && minDpr > 0 && minDpr <= maxDpr)) throw new RangeError('Invalid DPR');
  const previousDpr = renderer.getPixelRatio(), dprStep = 0.15;
  const top = steps.length + Math.ceil((maxDpr - minDpr) / dprStep - 1e-6);
  let width = 852, height = 393, level = 0;
  let elapsed = 0, frames = 0, warmup = 2;
  const dpr = () => Math.max(minDpr, maxDpr - dprStep * Math.max(0, level - steps.length));
  function apply() {
    renderer.setPixelRatio(dpr());
    renderer.setSize(width, height, false);
    onResize?.(dpr(), width, height);
  }
  apply();
  return { get level() { return level; }, resize(w: number, h: number) {
    if (!(w > 0 && h > 0 && Number.isFinite(w + h))) return;
    width = w; height = h; apply();
  }, sample(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (document.hidden || dt > 0.5) { elapsed = frames = 0; return; }
    if (warmup > 0) { warmup -= dt; return; }
    elapsed += dt; frames++;
    if (elapsed < 4) return;
    const fps = frames / elapsed, previous = level;
    elapsed = frames = 0;
    if (fps < 50 && level < top) level++;
    else if (fps >= 58 && level > 0) level--;
    if (level === previous) return;
    const step = Math.min(level, previous); // the one step that changed
    if (step < steps.length) steps[step](level > previous);
    else apply();
  }, dispose() {
    renderer.setPixelRatio(previousDpr);
    onResize?.(previousDpr, width, height);
  } };
}
