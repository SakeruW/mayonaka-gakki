// Draws one screen: a WebGL raster from crt.glsl, or a plain 2D fallback for browsers without WebGL.

import FS from "./crt.glsl?raw";
import type { Pos } from "./model";

const VS = "attribute vec2 p; varying vec2 v; void main(){ v = vec2(p.x, -p.y) * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
const UNIFORMS = ["u_pic", "u_res", "u_time", "u_off", "u_period", "u_glow", "u_zap", "u_crawl", "u_power", "u_snow", "u_seed", "u_touch", "u_text"] as const;
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

export interface TubeFrame {
  now: number;
  /** field roll, in fields */
  roll: number;
  /** whole field / visible part */
  period: number;
  text: boolean;
  glow: number;
  zap: number;
  crawl: number;
  power: number;
  snow: number;
  seed: number;
  hand: Pos;
  touches: Iterable<Pos>;
}

export interface Tube { upload(pic: HTMLCanvasElement): void; draw(f: TubeFrame): void; dispose(): void }

// StrictMode mounts, unmounts and remounts on the same canvas. A canvas only ever hands out one WebGL context,
// so the program is kept with the canvas and reused, and the context is only dropped once the canvas has left the page.
const glCache = new WeakMap<HTMLCanvasElement, { gl: WebGLRenderingContext; u: Uniforms }>();

function initGL(cv: HTMLCanvasElement) {
  const cached = glCache.get(cv);
  if (cached && !cached.gl.isContextLost()) return cached;
  let gl: WebGLRenderingContext | null = null;
  try { gl = cv.getContext("webgl", { antialias: false, alpha: false }); } catch { gl = null; }
  if (!gl) return null;
  const g = gl;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, src); g.compileShader(s);
    return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(g.VERTEX_SHADER, VS), fs = sh(g.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const pr = g.createProgram()!;
  g.attachShader(pr, vs); g.attachShader(pr, fs); g.linkProgram(pr);
  if (!g.getProgramParameter(pr, g.LINK_STATUS)) return null;
  g.useProgram(pr);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const lp = g.getAttribLocation(pr, "p"); g.enableVertexAttribArray(lp); g.vertexAttribPointer(lp, 2, g.FLOAT, false, 0, 0);
  g.bindTexture(g.TEXTURE_2D, g.createTexture());
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  const u = Object.fromEntries(UNIFORMS.map((k) => [k, g.getUniformLocation(pr, k)])) as Uniforms;
  const entry = { gl: g, u };
  glCache.set(cv, entry);
  return entry;
}

function fitCanvas(cv: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (w !== cv.width || h !== cv.height) { cv.width = w; cv.height = h; }
}

const wrap = (x: number) => ((x % 1) + 1) % 1;

export function createTube(cv: HTMLCanvasElement): Tube {
  const g = initGL(cv);
  if (g) {
    const { gl, u } = g;
    return {
      upload(pic) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic); },
      draw(f) {
        fitCanvas(cv);
        if (cv.width < 4) return;
        gl.viewport(0, 0, cv.width, cv.height);
        gl.uniform2f(u.u_res, cv.width, cv.height); gl.uniform1f(u.u_time, (f.now / 1000) % 1000);
        gl.uniform1f(u.u_off, f.text ? 0 : wrap(f.roll) * f.period); gl.uniform1f(u.u_text, f.text ? 1 : 0); gl.uniform1f(u.u_period, f.period);
        gl.uniform1f(u.u_glow, f.glow); gl.uniform1f(u.u_zap, f.zap); gl.uniform1f(u.u_crawl, f.text ? 0 : wrap(f.crawl));
        gl.uniform1f(u.u_power, f.power); gl.uniform1f(u.u_snow, f.snow); gl.uniform1f(u.u_seed, f.seed);
        gl.uniform3f(u.u_touch, f.hand.x, f.hand.y, f.glow);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      dispose() {
        // a remount puts the same canvas straight back; only a canvas that has really gone gives its context up
        setTimeout(() => { if (!cv.isConnected) { gl.getExtension("WEBGL_lose_context")?.loseContext(); glCache.delete(cv); } }, 0);
      },
    };
  }

  const x = cv.getContext("2d")!;
  let pic: HTMLCanvasElement | null = null;
  return {
    upload(p) { pic = p; },
    draw(f) {
      fitCanvas(cv);
      const W = cv.width, H = cv.height;
      if (W < 4) return;
      const period = H * f.period, off = f.text ? 0 : wrap(f.roll) * period;
      x.globalAlpha = 1; x.fillStyle = "#030605"; x.fillRect(0, 0, W, H);
      if (f.power <= 0 || !pic) return;
      x.globalAlpha = 0.8 + 0.2 * f.glow; x.imageSmoothingEnabled = true;
      for (let y = off - period; y < H; y += period) {
        x.drawImage(pic, 0, y, W, H);
        if (off) { x.fillStyle = "rgba(150,165,170,0.3)"; x.fillRect(0, y + H + (period - H) * 0.4, W, Math.max(2, (period - H) * 0.25)); }
      }
      x.globalAlpha = 1;
      for (const p of f.touches) {
        const gx = p.x * W, gy = p.y * H, r = W * 0.42, g = x.createRadialGradient(gx, gy, 0, gx, gy, r);
        g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
      if (f.zap > 0.02) { x.fillStyle = "rgba(230,240,255," + 0.5 * f.zap + ")"; for (let n = 0; n < 14; n++) x.fillRect(0, Math.random() * H, W, 1 + Math.random() * 2); }
    },
    dispose() {},
  };
}
