// The Geometry Wars-style post-process glow pipeline.
//
// `lines.ts` draws the crisp cores and their narrow analytic shoulder; this module produces the
// wide low-frequency halo: the same segments are drawn a second time into a low-resolution
// emissive "glow source" target, that target is blurred with a separable Gaussian (plus a second,
// wider halo at half again the resolution), and the result is added back over the scene in one
// composite pass.
//
//     scene RT  <- sharp cores + shoulder        (full res, RGBA16F when available)
//     GlowA     <- same segments, glow gain      (GLOW_SCALE * full res)
//     GlowA -H-> GlowB -V-> GlowA                (GLOW_PASSES separable Gaussian iterations)
//     WideA     <- GlowA downsampled + blurred   (broad halo)
//     default FB <- scene + GlowA*gain + WideA*gain
import { max, round } from "../core/system";
import { canvasH, canvasW, isGL2, onResize, onRestore } from "../core/viewport";
import { link } from "./gl";
import { glowGain, glowPasses, glowRadius, glowScale, tonemap, wideGain } from "./tune";

/** Vertex-attribute slot for the fullscreen post quad. `lines.ts` uses 0-4 for the beam batch. */
const QUAD_SLOT = 6;

// WebGL2 sized-format constants. Spelled out rather than read off the context so this file does
// not need a WebGL2RenderingContext type for what are just two integers.
const RGBA16F = 0x881a;
const HALF_FLOAT = 0x140b;

const VS = "attribute vec2 aQ;varying vec2 vT;void main(){vT=aQ*.5+.5;gl_Position=vec4(aQ,0,1);}";

// Five physical taps standing in for a nine-tap Gaussian: the outer pairs sit between texels so a
// single bilinear fetch returns the weighted sum of two samples. Offsets/weights are the standard
// linear-sampling reduction of the 1-2-4-8-16 binomial kernel.
const BLUR_FS = `precision highp float;
uniform sampler2D uS;uniform vec2 uD;varying vec2 vT;
void main(){
vec3 c=texture2D(uS,vT).rgb*.2270270270;
c+=(texture2D(uS,vT+uD*1.3846153846).rgb+texture2D(uS,vT-uD*1.3846153846).rgb)*.3162162162;
c+=(texture2D(uS,vT+uD*3.2307692308).rgb+texture2D(uS,vT-uD*3.2307692308).rgb)*.0702702703;
gl_FragColor=vec4(c,1.);
}`;

// The composite's gains are baked in as literals rather than passed as a uniform: three fewer
// uniform lookups is three fewer names in the bundle, and `tune.ts`'s getters fold to these same
// bare constants in a release build anyway. A debug build's `dev/gui.ts` gets to move them at
// runtime by recompiling this (`rebuildComposite`), same as `gl.ts`'s beam shader.
const buildCompFS = (): string => `precision highp float;
uniform sampler2D uC,uG,uW;varying vec2 vT;
void main(){
vec3 c=texture2D(uC,vT).rgb+texture2D(uG,vT).rgb*${glowGain().toFixed(3)}+texture2D(uW,vT).rgb*${wideGain().toFixed(3)};
gl_FragColor=vec4(mix(c,1.-exp(-c),${tonemap().toFixed(3)}),1.);
}`;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

let gl: WebGLRenderingContext;
let blurProg: WebGLProgram;
let compProg: WebGLProgram;
let uS: WebGLUniformLocation | null;
let uD: WebGLUniformLocation | null;

/** scene, glowA, glowB, wideA, wideB — rebuilt together whenever the backing store changes. */
const targets: Target[] = [];

/** Set at init: whether float render targets were actually obtained (affects HDR headroom, not correctness). */
let float16 = false;

const makeTarget = (w: number, h: number, useFloat: boolean): Target | undefined => {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (useFloat) {
    // RGBA16F is texture-filterable in WebGL2 core, so LINEAR below is safe without
    // OES_texture_float_linear.
    gl.texImage2D(gl.TEXTURE_2D, 0, RGBA16F, w, h, 0, gl.RGBA, HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  // LINEAR is not optional: the five-tap blur relies on bilinear fetches landing between texels,
  // and the composite upsamples the glow target back to full resolution.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  // Having the extension is not the same as the combination being renderable. Anything short of
  // COMPLETE and we fall back rather than draw garbage.
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return undefined;
  }
  return { fb, tex, w, h };
};

/** (Re)builds every render target for the current backing-store size. */
const buildTargets = (): void => {
  const w = max(1, canvasW());
  const h = max(1, canvasH());
  const gw = max(1, round(w * glowScale()));
  const gh = max(1, round(h * glowScale()));
  const ww = max(1, gw >> 1);
  const wh = max(1, gh >> 1);

  for (const t of targets) {
    gl.deleteFramebuffer(t.fb);
    gl.deleteTexture(t.tex);
  }
  targets.length = 0;

  const make = (tw: number, th: number): Target => {
    const t = float16 ? makeTarget(tw, th, true) : undefined;
    if (t) return t;
    float16 = false;
    return makeTarget(tw, th, false)!;
  };

  targets.push(make(w, h), make(gw, gh), make(gw, gh), make(ww, wh), make(ww, wh));

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

/** Compiles and links the composite program. Split out so a debug build's `dev/gui.ts` can
 *  relink after `glowGain`/`wideGain`/`tonemap` change, without touching the blur program, the
 *  quad buffer, or the render targets. */
const setupComposite = (): void => {
  compProg = link(gl, VS, buildCompFS(), (p) => gl.bindAttribLocation(p, QUAD_SLOT, "aQ"));
  gl.useProgram(compProg);
  gl.uniform1i(gl.getUniformLocation(compProg, "uC"), 0);
  gl.uniform1i(gl.getUniformLocation(compProg, "uG"), 1);
  gl.uniform1i(gl.getUniformLocation(compProg, "uW"), 2);
};

const setup = (): void => {
  blurProg = link(gl, VS, BLUR_FS, (p) => gl.bindAttribLocation(p, QUAD_SLOT, "aQ"));
  uS = gl.getUniformLocation(blurProg, "uS");
  uD = gl.getUniformLocation(blurProg, "uD");

  setupComposite();

  // Its own quad buffer on its own attribute slot, so it never fights `lines.ts` over
  // vertexAttribPointer state.
  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(QUAD_SLOT);
  gl.vertexAttribPointer(QUAD_SLOT, 2, gl.FLOAT, false, 0, 0);

  // A float scene target buys HDR headroom: additive emission can exceed 1.0 and stay there for
  // the composite's tonemap to bring back down, instead of clipping at the point of accumulation.
  // Having RGBA16F as a *texture* format is not the same as it being color-renderable — WebGL2
  // gates that behind EXT_color_buffer_float, and without it every glow framebuffer comes back
  // INCOMPLETE and silently falls back to 8-bit.
  float16 = isGL2() && !!(gl.getExtension("EXT_color_buffer_float") ?? gl.getExtension("EXT_color_buffer_half_float"));
  buildTargets();
};

export const initBloom = (context: WebGLRenderingContext): void => {
  gl = context;
  setup();
  onRestore(setup);
  onResize(() => {
    if (gl) buildTargets();
  });
};

/** Whether float render targets were actually obtained — the debug overlay's only consumer. */
export const bloomIsFloat = (): boolean => float16;

/** DEBUG-only: resizes the glow/wide targets after `dev/gui.ts` changes `tune.ts`'s `glowScale`. */
export const rebuildBloom = (): void => {
  if (gl) buildTargets();
};

/** DEBUG-only: recompiles the composite program after `dev/gui.ts` changes `glowGain`, `wideGain`,
 *  or `tonemap`. */
export const rebuildComposite = (): void => {
  if (gl) setupComposite();
};

/** Binds the offscreen scene target that the sharp core pass draws into, and clears it. */
export const bindScene = (): void => {
  const scene = targets[0]!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
  gl.viewport(0, 0, scene.w, scene.h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
};

/**
 * Binds and clears the low-resolution glow source, ready for the caller to redraw the same segment
 * batch into it.
 */
export const bindGlowSource = (): void => {
  const glowA = targets[1]!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, glowA.fb);
  gl.viewport(0, 0, glowA.w, glowA.h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
};

const drawQuad = (): void => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

/**
 * One separable pass: `src` -> `dst`, offset `dx`/`dy` *destination* texels.
 *
 * Destination, not source, on purpose. When the two are the same size it makes no difference, but
 * the wide-halo chain's first pass reads a full-size glow target into a half-size one — sizing the
 * kernel in source texels there steps over every other texel and aliases, which shows up as a
 * regular moire of dark dots across the halo.
 */
const blur = (src: Target, dst: Target, dx: number, dy: number): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
  gl.viewport(0, 0, dst.w, dst.h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  gl.uniform1i(uS, 0);
  gl.uniform2f(uD, dx / dst.w, dy / dst.h);
  drawQuad();
};

/**
 * Blurs the glow source and composites scene + halos into the default framebuffer.
 * Called once per frame, after every core segment has been drawn.
 */
export const post = (): void => {
  const scene = targets[0]!;
  const glowA = targets[1]!;
  const glowB = targets[2]!;
  const wideA = targets[3]!;
  const wideB = targets[4]!;

  // Blur and composite write, they do not accumulate — the global additive blend `lines.ts` leaves
  // enabled would otherwise turn every pass into a sum of itself.
  gl.disable(gl.BLEND);
  gl.useProgram(blurProg);

  // The step never grows across iterations: the five-tap kernel is the linear-sampled reduction of
  // a nine-tap Gaussian and only behaves like one while its taps stay adjacent. Past ~1.5 texels it
  // separates into five discrete ghosts of every bright feature, which interfere into a lattice of
  // dark dots across the halo. Radius comes from iteration count and from the resolution the blur
  // runs at instead.
  const r = glowRadius();
  for (let i = 0; i < glowPasses(); i++) {
    blur(glowA, glowB, r, 0);
    blur(glowB, glowA, 0, r);
  }

  // The broad halo. Its first pass doubles as the downsample into the half-size pair — the blur
  // shader reads the larger source through LINEAR, so the box filter comes for free — and a texel
  // goes twice as far down there, which is the whole reason it is cheap. Ordered so the last pass
  // lands in `wideA`, which the composite samples.
  blur(glowA, wideB, r, 0);
  blur(wideB, wideA, 0, r);
  blur(wideA, wideB, r, 0);
  blur(wideB, wideA, 0, r);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvasW(), canvasH());
  gl.useProgram(compProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, scene.tex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glowA.tex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, wideA.tex);
  drawQuad();

  gl.activeTexture(gl.TEXTURE0);
  gl.enable(gl.BLEND);
};
