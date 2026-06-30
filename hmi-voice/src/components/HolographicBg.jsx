import { useEffect, useRef } from 'react'

// Fluid pastel gradient background — WebGL fragment shader sampling 2D
// simplex noise with domain warping. Drifts very slowly (~uTime * 0.06) so
// the motion reads as "settled, breathing" rather than animated.
//
// Mounts a single <canvas> filling its parent. If WebGL is unavailable, the
// canvas stays empty and the underlying CSS background remains visible.

const VERT = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`

const FRAG = `
  precision highp float;
  uniform vec2  uResolution;
  uniform float uTime;
  varying vec2  vUv;

  /* Layered sinusoidal drift — two frequencies per axis so the path
     isn't a clean circle/ellipse. Reads as organic wandering. */
  vec2 drift(float t, float fx, float fy, float px, float py) {
    return vec2(
      0.22 * sin(t * fx + px)       + 0.09 * sin(t * fx * 2.3 + px * 1.7),
      0.20 * cos(t * fy + py)       + 0.08 * cos(t * fy * 1.8 + py * 0.9)
    );
  }

  // Soft Gaussian falloff. Slight pulse on the radius so each orb
  // breathes, making overlaps shift instead of holding a static shape.
  float orb(vec2 uv, vec2 center, float radius) {
    float d = length(uv - center);
    return exp(-pow(d / radius, 2.0) * 1.7);
  }

  void main() {
    /* Aspect-corrected space so orbs stay round on widescreens. */
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2  uv     = vec2(vUv.x * aspect, vUv.y);

    float t = uTime * 0.07;

    /* Slow cyclic phase 0 ↔ 1 over ~114s (~1m54s).
         phase ≈ 0 → Set A dominant.
         phase ≈ 1 → Set B dominant.
       Both sets are always drifting, but their orb radius + weight ramp
       in opposite directions so Set B's color literally takes more screen
       area as phase grows. */
    float phase = 0.5 - 0.5 * cos(uTime * 0.055);
    float wA   = mix(1.40, 0.25, phase);  // Set A weight multiplier
    float wB   = mix(0.25, 1.40, phase);  // Set B weight multiplier
    float sA   = mix(1.10, 0.72, phase);  // Set A radius scale (shrinks)
    float sB   = mix(0.72, 1.10, phase);  // Set B radius scale (grows)

    /* SET A — 3 orbs */
    vec2 a0 = vec2(0.22, 0.25) + drift(t, 0.70, 0.90, 0.0, 0.0);
    vec2 a1 = vec2(0.78, 0.20) + drift(t, 1.10, 0.65, 1.4, 2.1);
    vec2 a2 = vec2(0.50, 0.80) + drift(t, 0.85, 1.00, 3.0, 0.6);

    /* SET B — 4 orbs */
    vec2 b0 = vec2(0.15, 0.55) + drift(t, 0.90, 0.75, 2.0, 1.5);
    vec2 b1 = vec2(0.85, 0.75) + drift(t, 1.00, 0.85, 4.0, 2.5);
    vec2 b2 = vec2(0.85, 0.35) + drift(t, 0.75, 1.10, 5.0, 0.8);
    vec2 b3 = vec2(0.50, 0.15) + drift(t, 1.05, 0.70, 0.5, 3.0);

    a0.x *= aspect; a1.x *= aspect; a2.x *= aspect;
    b0.x *= aspect; b1.x *= aspect; b2.x *= aspect; b3.x *= aspect;

    /* Set A: cool/pink → D4E6FE blue · FCE2F5 pink · E6DEFB lavender */
    vec3 cBlue = vec3(0.831, 0.902, 0.996);
    vec3 cPink = vec3(0.988, 0.886, 0.961);
    vec3 cLav  = vec3(0.902, 0.871, 0.984);

    /* Set B: spring pastels — yellow replaced with a very pale cream
       (F6EFE0) so warmth is preserved without the saturated yellow
       overwhelming the rest of the palette. */
    vec3 cYel  = vec3(0.965, 0.937, 0.878); /* #F6EFE0 — soft cream */
    vec3 cGrn  = vec3(0.839, 0.937, 0.765); /* #D6EFC3 — pale green */
    vec3 cCyn  = vec3(0.824, 0.933, 0.961); /* #D2EEF5 — pale cyan */
    vec3 cPale = vec3(0.976, 0.945, 0.988); /* #F9F1FC — pale lavender */

    /* Smaller orbs + independent breathing — keeps white space visible
       between blooms so two colors never blanket the whole screen, and
       the constantly-shifting overlaps read as more dynamic. */
    float r0 = (0.42 + 0.05 * sin(t * 0.80))         * sA;
    float r1 = (0.40 + 0.06 * sin(t * 1.10 + 1.7))   * sA;
    float r2 = (0.44 + 0.05 * sin(t * 0.90 + 3.0))   * sA;
    float r3 = (0.41 + 0.05 * sin(t * 1.20 + 2.4))   * sB;
    float r4 = (0.43 + 0.05 * sin(t * 0.85 + 0.3))   * sB;
    float r5 = (0.40 + 0.06 * sin(t * 1.05 + 4.0))   * sB;
    float r6 = (0.46 + 0.05 * sin(t * 0.95 + 2.2))   * sB;

    /* Weighted influence — Set A gets wA, Set B gets wB. */
    float w0 = orb(uv, a0, r0) * wA;
    float w1 = orb(uv, a1, r1) * wA;
    float w2 = orb(uv, a2, r2) * wA;
    float w3 = orb(uv, b0, r3) * wB;
    float w4 = orb(uv, b1, r4) * wB;
    float w5 = orb(uv, b2, r5) * wB;
    float w6 = orb(uv, b3, r6) * wB;

    float wt = w0 + w1 + w2 + w3 + w4 + w5 + w6;

    /* Gamma-corrected (linear-space) weighted mix. Mixing pastels in sRGB
       space crushes mid-tones — the average of two distinct hues comes out
       grey/muddy. Converting each to linear, averaging, then converting back
       preserves perceived brightness, so overlapping pastels read as a
       brighter blend instead of a dirty mid-grey. */
    vec3 linMix = (pow(cBlue, vec3(2.2)) * w0
                 + pow(cPink, vec3(2.2)) * w1
                 + pow(cLav,  vec3(2.2)) * w2
                 + pow(cYel,  vec3(2.2)) * w3
                 + pow(cGrn,  vec3(2.2)) * w4
                 + pow(cCyn,  vec3(2.2)) * w5
                 + pow(cPale, vec3(2.2)) * w6)
                 / max(wt, 0.001);
    vec3 col = pow(linMix, vec3(1.0 / 2.2));

    /* Off-white base (#FAFAF9) so white space reads as "paper" rather than
       a hard clip. Smoothstep is biased so accumulated weight has to
       cross a threshold before color blooms — keeps swathes of #FAFAF9
       visible between orbs. */
    vec3 base  = vec3(0.980, 0.980, 0.976); // #FAFAF9
    vec3 final = mix(base, col, smoothstep(0.10, 1.20, wt));

    gl_FragColor = vec4(final, 1.0);
  }
`

function compileShader(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('[HolographicBg] shader compile failed:', gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

export default function HolographicBg() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false })
    if (!gl) {
      console.warn('[HolographicBg] WebGL unavailable — leaving canvas blank')
      return
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return

    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[HolographicBg] program link failed:', gl.getProgramInfoLog(prog))
      return
    }
    gl.useProgram(prog)

    // Fullscreen triangle pair
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,   1, -1,  -1,  1,
      -1,  1,   1, -1,   1,  1,
    ]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uTime       = gl.getUniformLocation(prog, 'uTime')
    const uResolution = gl.getUniformLocation(prog, 'uResolution')

    // Cap DPR at 1.5 so we don't render 7M+ shader pixels on a Retina display.
    const targetDpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      const nw = Math.max(1, Math.floor(w * targetDpr))
      const nh = Math.max(1, Math.floor(h * targetDpr))
      if (canvas.width !== nw || canvas.height !== nh) {
        canvas.width  = nw
        canvas.height = nh
        gl.viewport(0, 0, nw, nh)
      }
    }
    resize()

    let raf = 0
    const start = performance.now()
    const render = (now) => {
      resize()
      gl.uniform1f(uTime, (now - start) * 0.001)
      gl.uniform2f(uResolution, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      try {
        gl.deleteProgram(prog)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        gl.deleteBuffer(buf)
      } catch { /* noop */ }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  )
}
