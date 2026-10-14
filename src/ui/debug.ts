import { PerspectiveCamera, WebGLRenderer } from 'three';

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

// Only the screenshot tool opts in; override the follow camera immediately before rendering.
if (new URLSearchParams(location.search).get('shot') === '1') {
  let pose: number[] | undefined;
  const render = WebGLRenderer.prototype.render;
  WebGLRenderer.prototype.render = function (scene, camera) {
    if (pose && camera instanceof PerspectiveCamera) {
      camera.position.set(pose[0], pose[1], pose[2]);
      camera.lookAt(pose[3], pose[4], pose[5]);
      camera.updateMatrixWorld();
    }
    return render.call(this, scene, camera);
  };
  Object.assign(window, { __shot: {
    setCamera(pos?: number[], target?: number[]) {
      if (!pos && !target) { pose = undefined; return; }
      if (!pos || !target) throw Error('Camera needs position and target');
      if ([...pos, ...target].length !== 6 || ![...pos, ...target].every(Number.isFinite))
        throw Error('Camera needs six finite coordinates');
      pose = [...pos, ...target];
    },
    frame: () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  } });
}
