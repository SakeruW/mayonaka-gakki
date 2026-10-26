// One CRT tube: curvature, power-on, line jitter, the hand bending and tearing the lines, chroma offset,
// bloom, halation, ghost, field roll with the sync bar, flicker, hum bar, scanlines, aperture mask, noise, snow, vignette.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_pic; uniform vec2 u_res; uniform vec3 u_touch;
uniform float u_time, u_off, u_period, u_glow, u_zap, u_crawl, u_power, u_snow, u_seed, u_text;
varying vec2 v;
float h(vec2 q){ return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 tex(vec2 q){ return texture2D(u_pic, q).rgb; }
void main(){
  vec3 glass = vec3(0.012, 0.024, 0.02);
  vec2 c = v * 2.0 - 1.0; c *= 1.0 + 0.075 * dot(c, c); vec2 uv = c * 0.5 + 0.5;            // the bulge of the tube face
  float hh = clamp(u_power, 0.0, 1.0); hh = hh * hh * 0.5;                                   // power-on: the raster opens from a line
  if (u_power <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || abs(uv.y - 0.5) > max(hh, 0.002)) { gl_FragColor = vec4(glass, 1.0); return; }
  float sy = 0.5 + (uv.y - 0.5) * 0.5 / max(hh, 0.002);
  float fr = floor(u_time * 60.0);
  float wob = (h(vec2(floor(sy * 240.0), fr + u_seed)) - 0.5) * 0.002;                        // every line jitters a hair
  float near = u_touch.z * exp(-pow((sy - u_touch.y) * 5.0, 2.0));
  wob += near * 0.01 * sin(sy * 80.0 + u_time * 37.0);                                        // the hand bends the lines around it
  wob += u_zap * 0.06 * (h(vec2(floor(sy * 24.0), fr)) - 0.5);                                // and tears them when it lands
  float x = uv.x + wob;
  float f = mod(sy - u_off + u_zap * 0.03 * (1.0 - u_text), u_period);
  vec3 col;
  if (f > 1.0) { float b = (f - 1.0) / (u_period - 1.0); col = vec3(step(0.4, b) * step(b, 0.65) * 0.25); }   // blanking and the sync bar
  else {
    float py = fract(f + u_crawl), ca = 0.0016 + u_zap * 0.008;
    col = vec3(tex(vec2(x + ca, py)).r, tex(vec2(x, py)).g, tex(vec2(x - ca, py)).b);
    vec3 bl = tex(vec2(x, fract(py - 0.014))) + tex(vec2(x, fract(py + 0.014))) + tex(vec2(x - 0.02, py)) + tex(vec2(x + 0.02, py));
    col = col * 0.82 + bl * 0.09 + tex(vec2(x - 0.04, py)) * vec3(0.1, 0.12, 0.13);              // faint ghost from a second signal path
    col += (tex(vec2(x, fract(py - 0.04))) + tex(vec2(x, fract(py + 0.04))) + tex(vec2(x - 0.05, py)) + tex(vec2(x + 0.05, py))) * 0.035;   // halation round bright strokes
  }
  col *= (1.0 + 0.2 * u_glow) * (0.965 + 0.035 * h(vec2(fr, 7.0 + u_seed)));               // brightness and flicker
  if (u_text > 0.5) {                                                                       // text holds still; the beam does the moving
    float lum = dot(col, vec3(0.333)), d0 = fract(u_time * 0.55 + u_seed * 0.13) - sy;
    if (d0 < 0.0) d0 += 1.0;
    col *= 0.8 + 0.35 * exp(-d0 * 5.0);                                                       // phosphor still glowing behind the beam
    col += vec3(0.75, 0.9, 1.0) * exp(-pow(d0 * 60.0, 2.0)) * (0.12 + 0.5 * lum);              // the beam itself
    col *= mod(floor(sy * 240.0) + fr, 2.0) < 1.0 ? 1.0 : 0.88;                                // interlace
  }
  col *= 1.0 - 0.09 * (0.5 + 0.5 * sin((sy + u_time * 0.09) * 6.2831));                      // hum bar drifting through
  col *= 0.62 + 0.38 * pow(abs(sin(sy * min(240.0, u_res.y * 0.45) * 3.14159)), 0.7);         // scanlines
  float m = mod(gl_FragCoord.x, 3.0);
  col *= m < 1.0 ? vec3(1.0, 0.86, 0.86) : (m < 2.0 ? vec3(0.86, 1.0, 0.86) : vec3(0.86, 0.86, 1.0));   // phosphor stripes
  float n = h(vec2(floor(uv.x * u_res.x / 7.0), floor(sy * 240.0) + fr * 1.7 + u_seed));
  col += (n - 0.5) * 0.045;
  col = mix(col, vec3(n * 0.9), clamp(u_snow, 0.0, 1.0));                                    // snow between channels
  vec2 d = (v - u_touch.xy) * vec2(1.33, 1.0);
  col *= 1.0 + 0.55 * u_touch.z * exp(-dot(d, d) * 7.0);
  vec2 e = uv * (1.0 - uv); col *= pow(clamp(e.x * e.y * 16.0, 0.0, 1.0), 0.22);
  col *= 1.0 + (1.0 - hh * 2.0) * 2.5;
  gl_FragColor = vec4(glass + max(col, 0.0), 1.0);
}
