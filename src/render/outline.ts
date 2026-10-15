import { Color, NoBlending, PerspectiveCamera, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Toon A outlines for the city: one screen-space edge pass over the scene depth (the composer's render target
 *  must carry a DepthTexture). Lines sit on depth steps (silhouettes, Laplacian of linear depth) and on creases
 *  (view-space normals rebuilt from depth derivatives), one or two texels wide like the VRM hull outlines, and
 *  they darken the colour beneath them, so each line is its own material's dark shade rather than black.
 *  STYLE §3 (people and city alike, this pass is their only line): line colour = 50:50 of the colour beneath x0.25
 *  and the time's ink; silhouettes full weight to 15 m and 2/3 to 60 m, creases 2/3 and 1/3 past 30 m, all gone by
 *  90 m; none on emissive faces (HDR > 1.4: lit white cloth or plaster peaks near 1.2 here). Taps are spaced in CSS pixels, so the width holds when the dpr drops.
 *  Cost: one full-screen pass with 5 depth taps, no extra geometry or draw calls; chosen over inverted hulls,
 *  which would double the static city's 350k triangles and leave gaps at the boxy buildings' hard edges. */
export class ToonEdges extends Pass {
  readonly material = new ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false, blending: NoBlending,
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, texel: { value: new Vector2() },
      tanHalf: { value: new Vector2() }, nearFar: { value: new Vector2() }, strength: { value: 0.75 },
      ink: { value: new Color('#2a1c1c') } },
    vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse,tDepth;uniform vec2 texel,tanHalf,nearFar;uniform float strength;uniform vec3 ink;varying vec2 vUv;
      float depth(vec2 uv){float d=texture2D(tDepth,uv).r;return nearFar.x*nearFar.y/(nearFar.y-d*(nearFar.y-nearFar.x));}
      vec3 at(vec2 uv){float z=depth(uv);return vec3((uv*2.-1.)*tanHalf*z,-z);}
      vec3 normalAt(vec2 uv){vec3 p=at(uv),n=cross(dFdx(p),dFdy(p));float l=length(n);return l>0.?n/l:vec3(0.,0.,1.);} // flat sky: no NaN
      void main(){
        vec2 dx=vec2(texel.x,0.),dy=vec2(0.,texel.y);
        float zc=depth(vUv),zl=depth(vUv-dx),zr=depth(vUv+dx),zu=depth(vUv+dy),zd=depth(vUv-dy);
        float step_=max(abs(zl+zr-2.*zc),abs(zu+zd-2.*zc))/zc; // flat surfaces stay near zero at any angle
        vec3 n=normalAt(vUv);
        float bend=1.-min(min(dot(n,normalAt(vUv-dx)),dot(n,normalAt(vUv+dx))),min(dot(n,normalAt(vUv+dy)),dot(n,normalAt(vUv-dy))));
        float silhouette=smoothstep(.012,.03,step_)*mix(1.,.67,smoothstep(12.,18.,zc));
        float crease=smoothstep(.3,.6,bend)*mix(.67,.33,smoothstep(25.,35.,zc));
        vec4 c=texture2D(tDiffuse,vUv);
        float edge=max(silhouette,crease)*(1.-smoothstep(60.,90.,zc))*(1.-smoothstep(1.4,1.8,max(c.r,max(c.g,c.b))));
        gl_FragColor=vec4(mix(c.rgb,mix(c.rgb*(1.-strength),ink,.5),edge),c.a);}`,
  });
  private quad = new FullScreenQuad(this.material);
  constructor(private camera: PerspectiveCamera) { super(); }
  private size = new Vector2(1, 1);
  setSize(width: number, height: number) { this.size.set(width, height); }
  render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget) {
    const u = this.material.uniforms, tan = Math.tan(this.camera.fov * Math.PI / 360);
    const tap = Math.max(1, 0.75 * renderer.getPixelRatio()); // device pixels per 0.75 CSS px: ~1.5 CSS px lines
    u.texel.value.set(tap / this.size.x, tap / this.size.y);
    u.tDiffuse.value = read.texture; u.tDepth.value = read.depthTexture;
    u.tanHalf.value.set(tan * this.camera.aspect, tan); u.nearFar.value.set(this.camera.near, this.camera.far);
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}
