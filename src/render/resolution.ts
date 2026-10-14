// from research R001
import { WebGLRenderer } from 'three';

// Call sample(raw RAF delta in seconds); simulation-clamped delta hides stalls.
export function adaptiveResolution(renderer: WebGLRenderer,
  maxDpr = Math.min(window.devicePixelRatio || 1, 1.25),
  onResize?: (dpr: number, width: number, height: number) => void) {
  if (!(maxDpr > 0 && Number.isFinite(maxDpr))) throw new RangeError('Invalid DPR');
  const previousDpr = renderer.getPixelRatio();
  let width = 852, height = 393, multiplier = 1;
  let elapsed = 0, frames = 0, warmup = 2;
  function apply() {
    const dpr = maxDpr * multiplier;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    onResize?.(dpr, width, height);
  }
  apply();
  return { resize(w: number, h: number) {
    if (!(w > 0 && h > 0 && Number.isFinite(w + h))) return;
    width = w; height = h; apply();
  }, sample(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (document.hidden || dt > 0.5) { elapsed = frames = 0; return; }
    if (warmup > 0) { warmup -= dt; return; }
    elapsed += dt; frames++;
    if (elapsed < 4) return;
    const fps = frames / elapsed;
    const next = fps < 30 ? Math.max(0.6, multiplier - 0.1)
      : fps >= 58 ? Math.min(1, multiplier + 0.1) : multiplier;
    elapsed = frames = 0;
    if (Math.abs(next - multiplier) > 0.001) { multiplier = next; apply(); }
  }, dispose() {
    renderer.setPixelRatio(previousDpr);
    onResize?.(previousDpr, width, height);
  } };
}
