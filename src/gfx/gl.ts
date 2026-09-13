import { beamGain, haloIntensity, haloScale } from "./tune";

// Shader sources and compile/link helpers. Written pre-minified (1-2 char names) because there is
// no GLSL minifier in the build pipeline — whatever is typed here ships verbatim into the bundle.
//
// The beam pass draws an emissive line as a crisp analytic core plus a narrow local halo
// ("shoulder"), both from one distance-to-capsule evaluation. The wide low-frequency halo is the
// blur pass's job (gfx/bloom.ts) — the shoulder here is what keeps the picture reading as neon
// even with bloom turned down, instead of as flat vector strokes.
//
// Both are functions, not module-load-time constants, so a debug build's `dev/gui.ts` can
// recompile them against a changed `tune.ts` value (see `lines.ts` `rebuildBeam`). In a release
// build every `tune.ts` getter folds to its bare `tuning.ts` constant, so this indirection costs
// nothing there — `buildVS`/`buildFS` still run exactly once.

export const buildVS = (): string => `precision highp float;
attribute vec2 aA,aB;attribute float aK,aW;attribute vec4 aC;
uniform vec4 uP;uniform float uM;
varying vec3 vU;varying vec4 vC;varying float vW;
void main(){
float t=aK>1.5?1.:-1.;
vec2 p=aK>1.5?aB:aA,d=aB-aA;
float s=mod(aK,2.)*2.-1.,w=max(aW,uM),l=length(d);
d=l>1e-6?d/l:vec2(1,0);
vU=vec3(t,s,l);vC=aC;vW=w;
float o=w*${(1 + haloScale()).toFixed(3)};
gl_Position=vec4((p+(t*d+vec2(-d.y,d.x)*s)*o)*uP.xy+uP.zw,0,1);
}`;

// `q` is the fragment in the segment's own frame: q.x runs -o .. l+o along the axis, q.y spans the
// outer radius across it. Distance to the segment gives a capsule, so round caps and a zero-length
// dot both fall out of one expression with no special case.
//   uG    glow-band gain (1 for the screen pass)
//   uM    min half-width     uA    AA edge, one device pixel in logical units
//
// The shoulder is sized as a *fraction of the mark's own half-width*, never as an absolute pixel
// radius. Marks in this game shrink with tube depth while an absolute radius would not: deep
// geometry would end up mostly shoulder, and the spokes converging at the vanishing point would
// merge into one blown-out blob. Scaling with vW keeps a hairline a hairline.
export const buildFS = (): string => `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vU;varying vec4 vC;varying float vW;
uniform float uG,uA;
void main(){
float l=vU.z,r=vW*${haloScale().toFixed(3)},o=vW+r;
vec2 q=vec2((l*.5+o)*vU.x+l*.5,o*vU.y);
float d=length(q-vec2(clamp(q.x,0.,l),0.));
float c=1.-smoothstep(vW-uA,vW,d);
float h=1.-smoothstep(0.,1.,clamp((d-vW)/max(r,1e-4),0.,1.));
float e=vC.a*uG*(c*${beamGain().toFixed(3)}+h*h*${haloIntensity().toFixed(3)});
if(e<=0.)discard;
gl_FragColor=vec4(vC.rgb*e,e);
}`;

const compile = (gl: WebGLRenderingContext, type: number, src: string): WebGLShader => {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (__DEBUG__ && !gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
  }
  return sh;
};

/**
 * `bind` runs between attach and link — the post passes use it to pin their quad attribute to a
 * vertex-attribute slot the beam batch does not use, so the programs never fight over the same
 * `vertexAttribPointer` state.
 */
export const link = (
  gl: WebGLRenderingContext,
  vs: string,
  fs: string,
  bind?: (prog: WebGLProgram) => void,
): WebGLProgram => {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  bind?.(prog);
  gl.linkProgram(prog);
  if (__DEBUG__ && !gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
  }
  return prog;
};
