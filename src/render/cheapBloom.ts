// from research R002
import { NoBlending, HalfFloatType, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Linear HDR input, before LUT/tone mapping; no extra scene render. Leaves the scene buffer
 *  untouched and only fills `glow`, which the final pass (duskLUT) adds, so no full-size bloom pass. */
export class CheapBloom extends Pass {
  readonly material = new ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false, blending: NoBlending,
    uniforms: { tDiffuse: { value: null }, mode: { value: 0 },
      stepUV: { value: new Vector2() }, threshold: { value: 1.0 }, knee: { value: 0.3 } },
    vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse;
      uniform vec2 stepUV;uniform float mode,threshold,knee;varying vec2 vUv;
      vec3 bright(vec2 uv){vec3 c=texture2D(tDiffuse,uv).rgb;
        float y=max(c.r,max(c.g,c.b)); float k=max(knee,.0001);
        float soft=clamp(y-threshold+k,0.,2.*k);soft=soft*soft/(4.*k);
        return c*max(y-threshold,soft)/max(y,.0001);}
      void main(){if(mode<.5){
        vec3 c=bright(vUv+stepUV*vec2(-.5,-.5))+bright(vUv+stepUV*vec2(.5,-.5));
        c+=bright(vUv+stepUV*vec2(-.5,.5))+bright(vUv+stepUV*vec2(.5,.5));
        gl_FragColor=vec4(c*.25,1.);
      }else{vec3 c=texture2D(tDiffuse,vUv).rgb*.4;
        c+=(texture2D(tDiffuse,vUv+stepUV).rgb+texture2D(tDiffuse,vUv-stepUV).rgb)*.24;
        c+=(texture2D(tDiffuse,vUv+stepUV*2.).rgb+texture2D(tDiffuse,vUv-stepUV*2.).rgb)*.06;
        gl_FragColor=vec4(c,1.);}}`
  });
  private a = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private b = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private quad = new FullScreenQuad(this.material);
  private size = [1, 1];
  readonly glow = this.a.texture;
  constructor(private scale = 0.25) {
    super();
    this.needsSwap = false;
    this.setScale(scale);
  }
  setScale(scale: number) {
    if (!(scale > 0 && scale <= 1)) throw new Error('Bloom scale must be in (0,1].');
    this.scale = scale; this.setSize(this.size[0], this.size[1]);
  }
  setSize(width: number, height: number) {
    this.size = [width, height];
    const w = Math.max(1, Math.round(width * this.scale)), h = Math.max(1, Math.round(height * this.scale));
    this.a.setSize(w, h); this.b.setSize(w, h);
  }
  render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget) {
    const u = this.material.uniforms;
    const draw = (mode: number, input: WebGLRenderTarget, target: WebGLRenderTarget | null, x: number, y: number) => {
      u.mode.value = mode; u.tDiffuse.value = input.texture; u.stepUV.value.set(x, y);
      renderer.setRenderTarget(target); this.quad.render(renderer);
    };
    // Steps in glow texels; at 1/4 scale they match the old half-res filter's screen footprint.
    const x = 0.5 / this.a.width, y = 0.5 / this.a.height;
    draw(0, read, this.a, x, y);
    draw(1, this.a, this.b, x, 0);
    draw(1, this.b, this.a, 0, y);
  }
  dispose() { this.a.dispose(); this.b.dispose(); this.material.dispose(); this.quad.dispose(); }
}
