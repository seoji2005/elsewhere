import type { WebGLRenderer } from 'three';

// ?debug=1 overlay: fps (0.5 s average), render height in device pixels, draw calls and triangles
// of the last frame (renderer.info is reset once per frame), plus a state line from the caller.
export function debugOverlay(renderer: WebGLRenderer, state: () => string) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:4px;left:4px;z-index:9;padding:3px 6px;font:11px/1.35 monospace;'
    + 'color:#fff;background:rgba(0,0,0,.55);border-radius:4px;pointer-events:none;white-space:pre';
  document.body.append(box);
  let elapsed = 0, frames = 0;
  return { frame(dt: number) {
    elapsed += dt; frames++;
    if (elapsed < 0.5) return;
    const { calls, triangles } = renderer.info.render;
    box.textContent = `${Math.round(frames / elapsed)} fps · ${renderer.domElement.height}p\n`
      + `${calls} calls · ${Math.round(triangles / 1000)}k tris\n${state()}`;
    elapsed = frames = 0;
  } };
}
