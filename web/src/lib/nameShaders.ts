// CRV · Shaders de los efectos de nombre (GLSL ES 1.0, WebGL 1).
//
// Cada efecto es un material que vive dentro de las letras y sale de ellas.
// Todos comparten la cabecera: el campo del texto (`textField.ts`), ruido,
// relieve y unas gotas que cuelgan del borde inferior de cada letra.
//
// Coordenadas: `p` en píxeles del lienzo con origen arriba a la izquierda;
// `q = p / u_em` en «em» (alto de la fuente), así un efecto se ve igual a
// 13 px en la sala y a 22 px en el probador. La salida va premultiplicada.

export const NAME_SHADER_VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_res;
uniform float u_em;
uniform float u_range;
uniform float u_time;
uniform float u_seed;
uniform float u_intensity;
uniform float u_speed;
uniform vec3 u_col[6];
uniform vec4 u_box;
varying vec2 v_uv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.17)); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + vec2(5.3, 1.1); a *= 0.5; }
  return v / 0.875;
}
// Voronoi: x = distancia al centro más cercano, y = borde (F2 - F1), zw = id.
vec4 voronoi(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(i + g);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; id = i + g; } else if (d < f2) { f2 = d; }
    }
  }
  return vec4(f1, f2 - f1, id);
}

vec4 fieldAt(vec2 p) { return texture2D(u_field, clamp(p / u_res, vec2(0.0), vec2(1.0))); }
// Distancia con signo al borde de la letra, en píxeles (positiva dentro).
float sdAt(vec2 p) { return (fieldAt(p).g - 0.5) * 2.0 * u_range; }
// Columnas en em: dentro (desde arriba, desde abajo); fuera (bajo la letra
// de encima, sobre la letra de debajo). Valores grandes = no hay letra.
vec2 colAt(vec2 p) { return fieldAt(p).ba * u_res.y / u_em; }

// Distancia (em) hasta el borde superior de una letra debajo, suavizada en
// horizontal: así lo que sube (fuego, humo) no queda cortado en columnas.
float aboveSoft(vec2 p) {
  float best = 9.0;
  for (int k = -4; k <= 4; k++) {
    float dx = float(k) * 0.055;
    vec2 c = colAt(p + vec2(dx * u_em, 0.0));
    float v = c.y < 1.4 ? c.y + abs(dx) * 1.7 : 9.0;
    best = min(best, v);
  }
  return best;
}

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
vec4 pm(vec3 c, float a) { a = clamp(a, 0.0, 1.0); return vec4(c * a, a); }

// Relieve redondeado: altura = sqrt(distancia / ancho), normal por diferencias.
float bevelH(vec2 p, float w) { return sqrt(clamp(sdAt(p) / w, 0.0, 1.0)); }
vec3 bevelN(vec2 p, float w) {
  float e = 1.0;
  float hx = bevelH(p + vec2(e, 0.0), w) - bevelH(p - vec2(e, 0.0), w);
  float hy = bevelH(p + vec2(0.0, e), w) - bevelH(p - vec2(0.0, e), w);
  return normalize(vec3(-hx, -hy, 0.55));
}
const vec3 LIGHT = vec3(-0.42, -0.62, 0.66);
float specular(vec3 n, float power) {
  vec3 h = normalize(normalize(LIGHT) + vec3(0.0, 0.0, 1.0));
  return pow(clamp(dot(n, h), 0.0, 1.0), power);
}
float diffuse(vec3 n) { return clamp(dot(n, normalize(LIGHT)), 0.0, 1.0); }
// Material líquido brillante (sangre, ácido, oro): difusa, brillo ancho y punto.
vec3 wet(vec3 base, vec3 n, vec3 tint, float gloss) {
  return base * (0.42 + 0.75 * diffuse(n)) + tint * specular(n, 10.0) * 0.28 * gloss
    + vec3(1.0, 0.96, 0.94) * specular(n, 60.0) * 1.1 * gloss;
}
float boxW() { return (u_box.z - u_box.x) / u_em; }
vec2 boxCenter() { return vec2(u_box.x + u_box.z, u_box.y + u_box.w) * 0.5; }

// Gotas que cuelgan del borde inferior de las letras: crecen, estrechan el
// cuello, se sueltan y caen; el remanente se retrae. Cada columna tiene su
// fase. Devuelve color premultiplicado.
vec4 drips(vec2 p, float t, float density, float speed, vec3 deep, vec3 base, vec3 tint) {
  vec2 q = p / u_em;
  float cw = 0.34;
  vec4 acc = vec4(0.0);
  for (int k = -1; k <= 1; k++) {
    float idx = floor(q.x / cw) + float(k);
    float h1 = hash(vec2(idx, u_seed + 1.0));
    if (h1 > density) continue;
    float h2 = hash(vec2(idx, u_seed + 2.0));
    float h3 = hash(vec2(idx, u_seed + 3.0));
    float cx = (idx + 0.25 + 0.5 * h2) * cw;
    vec4 fc = fieldAt(vec2(cx * u_em, p.y));
    float below = fc.b * u_res.y / u_em;
    if (fc.r > 0.5 || below > 1.4) continue;
    // Solo cuelgan de bordes de verdad: el trazo de encima tiene grosor.
    float period = (2.4 + 3.4 * h3) / speed;
    float ph = fract(t / period + h2 * 3.1);
    float grow = smoothstep(0.0, 0.74, ph);
    float len = mix(0.05, 0.36 + 0.34 * h1 / max(density, 0.01), grow);
    float rb = mix(0.045, 0.085 + 0.03 * h3, grow);
    float dx = q.x - cx;
    float y = below;
    float neck = mix(0.062, 0.03, smoothstep(0.55, 0.78, ph));
    float w = mix(0.1, neck, smoothstep(0.0, max(len - rb, 0.02), sqrt(max(y, 0.0) * max(len - rb, 0.02))));
    float body = (y <= len - rb * 0.4) ? w - abs(dx) : -1.0;
    float bulbY = len - rb;
    float bulb = rb - length(vec2(dx, (y - bulbY) * 0.85));
    float shape = max(body, bulb);
    float nx = clamp(dx / max(rb, 0.02), -1.0, 1.0);
    float ny = clamp((y - bulbY) / max(rb, 0.02), -1.0, 1.0);
    if (ph > 0.8) {
      float f = (ph - 0.8) / 0.2;
      float dropY = bulbY + f * f * 1.6;
      float drop = rb * 0.9 - length(vec2(dx, (y - dropY) * 0.72));
      float rem = mix(len * 0.45, 0.05, f);
      float remShape = (y <= rem) ? mix(0.09, 0.04, y / max(rem, 0.02)) - abs(dx) : -1.0;
      shape = max(remShape, drop);
      ny = clamp((y - dropY) / max(rb, 0.02), -1.0, 1.0);
      if (y > dropY + rb) shape = -1.0;
    }
    float a = clamp(shape * u_em + 0.5, 0.0, 1.0);
    if (a <= 0.0) continue;
    vec3 n = normalize(vec3(-nx * 0.9, -0.35 - ny * 0.5, 0.75));
    vec3 col = wet(mix(base, deep, 0.25 + 0.3 * smoothstep(0.0, 0.3, y)), n, tint, 1.0);
    acc = over(pm(col, a), acc);
  }
  return acc;
}
`;

const BLOOD = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec2 c = colAt(p);
    // La sangre corre hacia abajo por dentro del trazo.
    vec2 fq = vec2(q.x * 6.5, q.y * 2.0 - t * 0.85);
    float flow = fbm(fq + vec2(0.0, fbm(fq * 0.6 + t * 0.12) * 1.6));
    float streak = smoothstep(0.5, 0.9, noise(vec2(q.x * 17.0, q.y * 1.4 - t * 1.25)));
    float pool = smoothstep(0.32, 0.0, c.y);
    vec3 base = mix(u_col[1], u_col[2], smoothstep(0.25, 0.85, flow));
    base = mix(base, u_col[3], streak * 0.4);
    base = mix(base, u_col[0], pool * 0.6);
    float bw = max(1.6, u_em * 0.085);
    vec3 n = bevelN(p, bw);
    n.xy += (vec2(noise(fq * 1.6), noise(fq * 1.6 + 9.0)) - 0.5) * 0.5;
    n = normalize(n);
    vec3 col = wet(base, n, u_col[4], 1.0);
    // Reflejos alargados que bajan con el líquido.
    float gloss = smoothstep(0.62, 0.92, noise(vec2(q.x * 11.0, q.y * 2.2 - t * 1.6)));
    col += vec3(1.0, 0.85, 0.82) * gloss * specular(n, 6.0) * 0.55;
    // Borde fino translúcido: la luz atraviesa el líquido.
    col += u_col[3] * 0.32 * (1.0 - smoothstep(0.0, bw * 1.3, sd));
    // Gotas que bajan por dentro de la letra.
    float cell = floor(q.x / 0.36);
    float hb = hash(vec2(cell, u_seed + 7.0));
    float run = c.x + c.y;
    float beadY = fract(t * (0.16 + 0.2 * hb) + hb * 7.0) * (run + 0.5) - 0.25;
    float bx = (cell + 0.3 + 0.4 * hash(vec2(cell, 3.0))) * 0.36;
    float bd = length(vec2(q.x - bx, (c.x - beadY) * 0.55));
    float bead = smoothstep(0.07, 0.025, bd) * step(0.4, hb);
    col = mix(col, u_col[4] * 1.15, bead * 0.6);
    // Variante intensa: oleadas frescas que bajan desde arriba.
    if (u_intensity > 0.9) {
      float ph = fract(t / 5.0 + u_seed * 0.13);
      float front = ph * 1.9 - 0.35 + (fbm(vec2(q.x * 4.0, t * 0.2)) - 0.5) * 0.4;
      float fresh = smoothstep(0.16, 0.0, abs(c.x - front));
      col += u_col[3] * fresh * 0.55;
    }
    res = pm(col, inside);
  }
  if (sd < 0.5) {
    float density = mix(0.45, 0.8, smoothstep(0.6, 1.0, u_intensity));
    res = over(res, drips(p, t, density, 1.0, u_col[0], u_col[2], u_col[4]));
    // Sombra húmeda bajo las letras.
    float od = max(-sd, 0.0) / u_em;
    res = over(res, pm(u_col[0], 0.35 * exp(-od / 0.05) * step(sd, 0.0)));
  }
  return res;
}`;

const FIRE = `
vec3 fireRamp(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(u_col[0], u_col[1], smoothstep(0.0, 0.28, h));
  c = mix(c, u_col[2], smoothstep(0.22, 0.52, h));
  c = mix(c, u_col[3], smoothstep(0.5, 0.78, h));
  return mix(c, u_col[4], smoothstep(0.8, 1.0, h));
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec2 c = colAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec2 fq = vec2(q.x * 2.8, q.y * 1.7 + t * 1.9);
  float warp = fbm3(fq * 0.7 + vec2(0.0, t * 0.5));
  float n = fbm(fq + vec2(warp * 1.4 - 0.7, 0.0));
  float lick = noise(vec2(q.x * 7.0, q.y * 3.5 + t * 4.2));
  vec4 res = vec4(0.0);
  // Llamas: nacen en los bordes de arriba y en los laterales cercanos.
  if (sd < 0.5) {
    float above = aboveSoft(p);
    float reach = 0.42 + 0.5 * u_intensity;
    float source = min(above / reach, od / 0.09 + 0.35);
    float tongues = noise(vec2(q.x * 5.5, q.y * 1.2 + t * 2.6));
    float heat = n * 1.3 + tongues * 0.35 + lick * 0.15 - source - 0.2;
    float a = smoothstep(0.0, 0.3, heat);
    vec3 col = fireRamp(heat * 1.05 + 0.08);
    res = pm(col, a * 0.92);
    // Brasas que suben.
    vec2 gq = vec2(q.x * 5.0, (q.y + t * 0.9) * 5.0);
    vec2 cell = floor(gq);
    vec2 jitter = hash2(cell + u_seed);
    float spark = step(0.86, hash(cell + 3.1)) * smoothstep(0.09, 0.0, length(fract(gq) - jitter));
    float life = clamp(1.0 - above / (reach * 2.2), 0.0, 1.0) * step(above, 2.0);
    res = over(pm(fireRamp(0.92), spark * life), res);
    // Resplandor alrededor.
    res = over(res, pm(u_col[2], 0.38 * exp(-od / 0.12)));
  }
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    // La letra es metal incandescente: núcleo blanco amarillo que late, borde
    // carbonizado que la separa de las llamas.
    vec2 c2 = colAt(p);
    float glowIn = fbm3(q * vec2(4.0, 2.0) + vec2(0.0, t * 1.4));
    float depth = smoothstep(0.0, max(2.0, u_em * 0.07), sd);
    float hot = 0.68 + 0.3 * glowIn + 0.12 * smoothstep(0.0, 0.6, c2.x) - 0.1 * smoothstep(0.25, 0.0, c2.x);
    vec3 col = fireRamp(hot);
    vec3 nrm = bevelN(p, max(1.5, u_em * 0.08));
    col = col * (0.75 + 0.35 * diffuse(nrm)) + u_col[4] * specular(nrm, 24.0) * 0.5;
    col = mix(u_col[0] * 0.7, col, smoothstep(0.0, 0.85, depth));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const LIGHTNING = `
float bolt(vec2 p, float t, float k) {
  float rate = 5.0 + k * 1.7;
  float tq = floor(t * rate + k * 0.37);
  float hb = hash(vec2(tq, k + u_seed));
  if (hb < 0.12) return 0.0;
  vec2 q = p / u_em;
  float x0 = u_box.x / u_em + (hash(vec2(tq, k + 2.0)) * 0.7 - 0.2) * boxW();
  float len = boxW() * (0.35 + 0.6 * hash(vec2(tq, k + 3.0)));
  float s = (q.x - x0) / len;
  if (s < 0.0 || s > 1.0) return 0.0;
  float cy = boxCenter().y / u_em + (hash(vec2(tq, k + 4.0)) - 0.5) * 0.5;
  float y = cy + (fbm3(vec2(q.x * 2.6, tq * 7.3 + k)) - 0.5) * 1.1
    + (noise(vec2(q.x * 16.0, tq + k)) - 0.5) * 0.16;
  float taper = smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.9, s);
  float d = abs(q.y - y);
  float flick = 0.65 + 0.35 * step(0.5, fract(t * 34.0 + hb * 9.0));
  float core = exp(-d * 95.0);
  float glow = exp(-d * 13.0) * 0.55;
  // Rama corta.
  float bx = x0 + len * (0.3 + 0.4 * hash(vec2(tq, k + 5.0)));
  float bs = (q.x - bx) / (len * 0.35);
  float branch = 0.0;
  if (bs > 0.0 && bs < 1.0) {
    float by = y + bs * (hash(vec2(tq, k + 6.0)) - 0.5) * 1.2 + (noise(vec2(q.x * 18.0, tq * 3.0)) - 0.5) * 0.12;
    float bd = abs(q.y - by);
    branch = (exp(-bd * 120.0) + exp(-bd * 18.0) * 0.3) * (1.0 - bs);
  }
  return (core + glow + branch) * taper * flick;
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  float energy = bolt(p, t, 0.0) + bolt(p, t, 1.0) * step(0.5, u_intensity) + bolt(p, t, 2.0) * step(0.85, u_intensity);
  float flash = 1.0 - fract(t * 5.0);
  flash = flash * flash * step(0.3, hash(vec2(floor(t * 5.0), u_seed)));
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec3 n = bevelN(p, max(1.5, u_em * 0.08));
    float plasma = fbm(q * 4.0 + vec2(t * 0.9, -t * 0.5));
    float veins = pow(1.0 - abs(noise(q * vec2(7.0, 9.0) + vec2(t * 2.5, -t * 1.5)) * 2.0 - 1.0), 6.0);
    vec3 col = mix(u_col[2], u_col[1], smoothstep(0.3, 0.8, plasma));
    col = col * (0.62 + 0.5 * diffuse(n)) + u_col[0] * specular(n, 30.0) * 0.7;
    col = mix(col, u_col[0], veins * 0.75);
    col = mix(u_col[3], col, smoothstep(0.0, max(1.5, u_em * 0.06), sd) * 0.8 + 0.2);
    // El contorno chisporrotea: tramos que corren por el borde.
    float edge = 1.0 - smoothstep(0.0, max(1.6, u_em * 0.07), sd);
    float crawl = smoothstep(0.55, 0.9, noise(vec2(q.x * 9.0 - t * 14.0, q.y * 9.0 + t * 6.0)));
    col += u_col[1] * edge * (0.35 + crawl * 1.4);
    col += u_col[2] * flash * 0.35;
    res = pm(col, inside);
  }
  // Halo eléctrico y arcos de borde fuera de la letra.
  float rim = exp(-od / 0.06) * (0.25 + 0.6 * flash);
  float fuzz = pow(1.0 - abs(noise(q * 22.0 + t * 9.0) * 2.0 - 1.0), 8.0) * exp(-od / 0.08);
  vec3 glowCol = u_col[2];
  res = over(res, pm(glowCol, (rim + fuzz * 0.9) * step(sd, 0.5)));
  // Rayos que cruzan el nombre, por encima de todo.
  float e = clamp(energy, 0.0, 1.6);
  vec3 bc = mix(u_col[2], u_col[0], smoothstep(0.5, 1.2, e));
  res = over(pm(bc, clamp(e, 0.0, 1.0)), res);
  return res;
}`;

const NEON = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  // Tramos del tubo que fallan de vez en cuando y chisporrotean.
  // Un tramo (más o menos una letra) falla a ratos; la transición entre
  // tramos es suave para que el halo no dibuje cajas.
  float sx = q.x / 0.62;
  float section = floor(sx);
  float window = floor(t * 0.9);
  float failing = step(hash(vec2(section, window + u_seed)), 0.08 * u_intensity);
  float edgeFade = smoothstep(0.0, 0.18, fract(sx)) * smoothstep(1.0, 0.82, fract(sx));
  failing *= edgeFade;
  float buzz = step(0.45, noise(vec2(t * 38.0, section * 3.1)));
  float on = mix(1.0, 0.25 + 0.75 * buzz, failing);
  on *= 0.94 + 0.06 * noise(vec2(t * 22.0, 1.0));
  vec4 res = vec4(0.0);
  // Halo: dos capas de luz y el reflejo en la pared.
  float halo = exp(-od / 0.07) * 0.75 + exp(-od / 0.15) * 0.3;
  res = pm(u_col[0], halo * on * step(sd, 0.5));
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    float core = smoothstep(0.15, 1.0, sd / max(1.5, u_em * 0.07));
    vec3 lit = mix(u_col[0], u_col[1], smoothstep(0.0, 0.5, core));
    lit = mix(lit, u_col[2], smoothstep(0.55, 1.0, core));
    vec3 n = bevelN(p, max(1.4, u_em * 0.07));
    vec3 glass = mix(u_col[3], u_col[0], 0.35) * (0.6 + 0.5 * diffuse(n)) + vec3(1.0) * specular(n, 40.0) * 0.5;
    vec3 col = mix(glass, lit * 1.15, on) + vec3(1.0) * specular(n, 50.0) * 0.35;
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const GOLD = `
vec3 env(vec3 n, vec2 q, float t) {
  vec3 r = vec3(2.0 * n.z * n.x, 2.0 * n.z * n.y, 2.0 * n.z * n.z - 1.0);
  float band = 0.5 + 0.5 * sin((r.y * 2.4 + r.x * 0.9 + q.x * 0.25) * 3.14159 + t * 0.6);
  vec3 c = mix(u_col[1], u_col[3], band);
  return c + u_col[4] * pow(smoothstep(0.62, 1.0, band), 3.0) * 0.9;
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec3 n = bevelN(p, max(1.8, u_em * 0.1));
    // Superficie fundida que se mueve despacio.
    vec2 mq = q * 1.6 + vec2(t * 0.18, -t * 0.3);
    float m0 = noise(mq);
    n.xy += vec2(noise(mq + vec2(0.08, 0.0)) - m0, noise(mq + vec2(0.0, 0.08)) - m0) * 3.2;
    n = normalize(n);
    vec3 col = env(n, q, t) * (0.55 + 0.6 * diffuse(n));
    col = mix(col, u_col[0], 0.25 * (1.0 - smoothstep(0.0, 2.5, sd)));
    col += u_col[4] * specular(n, 70.0) * 1.2;
    // Barrido de luz diagonal.
    float sweep = mod(t * 0.9, boxW() + 4.0) - 2.0 + u_box.x / u_em;
    col += u_col[4] * exp(-pow((q.x + q.y * 0.55 - sweep) * 3.2, 2.0)) * 0.55;
    // Destellos en estrella.
    vec2 gq = q * 2.2;
    vec2 cell = floor(gq);
    vec2 sp = hash2(cell + u_seed);
    vec2 d = (fract(gq) - sp) * 9.0;
    float tw = pow(max(sin(t * 2.3 + hash(cell) * 40.0), 0.0), 12.0);
    float star = (exp(-abs(d.x) * 7.0) * exp(-abs(d.y) * 0.8) + exp(-abs(d.y) * 7.0) * exp(-abs(d.x) * 0.8)) * tw;
    col += u_col[4] * star * step(0.55, hash(cell + 9.0));
    res = pm(col, inside);
  }
  if (sd < 0.5) {
    res = over(res, drips(p, t, 0.32, 0.55, u_col[1], u_col[2], u_col[4]));
    res = over(res, pm(u_col[3], 0.22 * exp(-max(-sd, 0.0) / u_em / 0.1) * step(sd, 0.0)));
  }
  return res;
}`;

const FROST = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec4 res = vec4(0.0);
  // Vaho frío que baja y se deshace.
  vec2 c = colAt(p);
  if (sd < 0.0 && c.x < 1.2) {
    float mist = fbm(q * vec2(2.2, 3.2) + vec2(t * 0.12, -t * 0.32));
    float a = smoothstep(0.55, 0.9, mist) * exp(-c.x / 0.25) * 0.22;
    res = pm(u_col[3], a);
  }
  // Cristales que crecen desde el borde.
  if (sd < 0.5) {
    float spikes = fbm(q * 26.0 + vec2(0.0, t * 0.05));
    float a = smoothstep(0.42, 0.62, spikes - od * 7.0) * step(od, 0.15);
    res = over(pm(u_col[4], a * 0.85), res);
    res = over(res, pm(u_col[2], 0.3 * exp(-od / 0.08)));
  }
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec4 v = voronoi(q * 5.5);
    vec3 n = bevelN(p, max(1.6, u_em * 0.09));
    n.xy += (hash2(v.zw) - 0.5) * 0.7;
    n = normalize(n);
    float depth = smoothstep(0.0, max(2.5, u_em * 0.1), sd);
    vec3 col = mix(u_col[2], u_col[1], depth * 0.75);
    col = mix(col, u_col[0], depth * 0.3);
    col = col * (0.55 + 0.6 * diffuse(n)) + u_col[4] * specular(n, 45.0) * 0.9;
    col += u_col[3] * smoothstep(0.08, 0.0, v.y) * 0.35;
    // Escarcha en el borde de la letra.
    float frost = smoothstep(0.35, 0.75, fbm(q * 22.0)) * (1.0 - smoothstep(0.0, u_em * 0.06 + 1.5, sd));
    col = mix(col, u_col[4], frost * 0.8);
    float sweep = mod(t * 0.8, boxW() + 4.0) - 2.0 + u_box.x / u_em;
    col += u_col[4] * exp(-pow((q.x - q.y * 0.6 - sweep) * 3.5, 2.0)) * 0.6;
    vec2 gq = q * 6.0;
    float tw = pow(max(sin(t * 3.0 + hash(floor(gq)) * 50.0), 0.0), 20.0);
    col += u_col[4] * tw * smoothstep(0.12, 0.0, length(fract(gq) - hash2(floor(gq)))) * step(0.7, hash(floor(gq) + 3.0));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const SNOW = `
vec4 flakes(vec2 q, float t, float scale, float speed, float size) {
  vec2 gq = vec2(q.x * scale + sin(q.y * 2.0 + t * 0.7) * 0.25, (q.y - t * speed) * scale);
  vec2 cell = floor(gq);
  vec2 sp = hash2(cell + u_seed);
  float d = length(fract(gq) - sp);
  float a = smoothstep(size, size * 0.4, d) * step(0.72, hash(cell + 7.0));
  // Solo nieva sobre el nombre: nada a los lados, se desvanece abajo.
  float inX = smoothstep(u_box.x - 0.05 * u_em, u_box.x + 0.25 * u_em, q.x * u_em) * smoothstep(u_box.z + 0.05 * u_em, u_box.z - 0.25 * u_em, q.x * u_em);
  float near = inX * smoothstep(u_box.w + 0.3 * u_em, u_box.w - 0.1 * u_em, q.y * u_em);
  return pm(u_col[3], a * 0.95 * near);
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec2 c = colAt(p);
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec3 n = bevelN(p, max(1.6, u_em * 0.09));
    float depth = smoothstep(0.0, max(2.5, u_em * 0.1), sd);
    vec3 col = mix(u_col[2], u_col[1], depth * 0.7);
    col = col * (0.5 + 0.65 * diffuse(n)) + u_col[3] * specular(n, 40.0) * 0.8;
    float frost = smoothstep(0.4, 0.8, fbm(q * 18.0)) * (1.0 - smoothstep(0.0, u_em * 0.05 + 1.2, sd));
    col = mix(col, u_col[3], frost * 0.6);
    res = pm(col, inside);
  }
  // Nieve posada encima de cada borde superior.
  if (sd < 0.5 && c.y < 0.5) {
    float cap = (0.06 + 0.07 * noise(vec2(q.x * 4.0, u_seed)) + 0.03 * noise(vec2(q.x * 13.0, 2.0))) * (0.6 + 0.4 * u_intensity);
    float sh = cap - c.y;
    if (sh > -0.02) {
      float a = clamp(sh * u_em + 0.5, 0.0, 1.0);
      float k = clamp(c.y / max(cap, 0.01), 0.0, 1.0);
      vec3 col = mix(u_col[2] * 0.85, u_col[3], smoothstep(0.0, 0.8, k));
      col += u_col[3] * pow(max(sin(t * 2.0 + hash(floor(q * 30.0)) * 30.0), 0.0), 30.0) * 0.6;
      res = over(pm(col, a), res);
    }
  }
  // Copos que caen delante y detrás.
  res = over(flakes(q, t, 4.5, 0.32, 0.12), res);
  res = over(res, flakes(q + 3.7, t, 7.5, 0.2, 0.1) * 0.6);
  return res;
}`;

const ACID = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec2 c = colAt(p);
  vec4 res = vec4(0.0);
  if (sd < 0.5) {
    // Vapores tóxicos que suben.
    float above = aboveSoft(p);
    float fume = fbm(q * vec2(2.5, 1.8) + vec2(0.0, t * 0.6));
    float a = smoothstep(0.5, 0.85, fume) * exp(-above / 0.35) * 0.4;
    res = pm(u_col[3], a);
    res = over(res, pm(u_col[2], 0.42 * exp(-od / 0.1)));
    res = over(drips(p, t, 0.55, 0.85, u_col[1], u_col[2], u_col[4]), res);
  }
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    float flow = fbm(q * vec2(4.0, 3.0) + vec2(0.0, t * 0.5));
    vec3 base = mix(u_col[1], u_col[2], smoothstep(0.3, 0.8, flow));
    vec3 n = bevelN(p, max(1.6, u_em * 0.085));
    vec3 col = wet(base, n, u_col[4], 0.9);
    // Burbujas que suben dentro de la letra.
    vec2 gq = vec2(q.x, q.y + t * 0.4) / 0.2;
    vec2 cell = floor(gq);
    vec2 sp = 0.25 + 0.5 * hash2(cell + u_seed);
    float r = 0.18 + 0.16 * hash(cell + 2.0);
    float d = length(fract(gq) - sp);
    float alive = step(0.45, hash(cell + 5.0));
    float ring = (smoothstep(r, r - 0.06, d) - smoothstep(r - 0.1, r - 0.16, d)) * alive;
    float spec = smoothstep(0.08, 0.0, length(fract(gq) - sp + vec2(r * 0.35, r * 0.4))) * alive;
    col = mix(col, u_col[3], ring * 0.8);
    col += u_col[4] * spec;
    col += u_col[3] * 0.25 * (1.0 - smoothstep(0.0, 2.0, sd));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const HOLO = `
vec3 palette6(float x) {
  x = fract(x) * 6.0;
  float i = floor(x);
  float f = smoothstep(0.0, 1.0, fract(x));
  vec3 a = u_col[0];
  vec3 b = u_col[1];
  if (i > 0.5) { a = u_col[1]; b = u_col[2]; }
  if (i > 1.5) { a = u_col[2]; b = u_col[3]; }
  if (i > 2.5) { a = u_col[3]; b = u_col[4]; }
  if (i > 3.5) { a = u_col[4]; b = u_col[5]; }
  if (i > 4.5) { a = u_col[5]; b = u_col[0]; }
  return mix(a, b, f);
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec4 res = pm(palette6(q.x * 0.2 - t * 0.1), 0.3 * exp(-od / 0.1) * step(sd, 0.5));
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec3 n = bevelN(p, max(1.6, u_em * 0.09));
    vec4 v = voronoi(q * 7.0);
    vec3 nf = normalize(n + vec3((hash2(v.zw) - 0.5) * 0.08, 0.0));
    // Bandas de color que cruzan en diagonal y se doblan con el relieve.
    float angle = (q.x * 0.55 + q.y * 0.35) * 0.55 - t * 0.12 + dot(nf.xy, vec2(0.8, 0.5)) * 0.45 + fbm3(q * 0.9 + t * 0.05) * 0.25;
    vec3 col = palette6(angle);
    col = mix(col, vec3(1.0), 0.06 * (1.0 - u_intensity));
    // Pastel: se refuerza el tono para que no se lave en blanco.
    col = mix(col, col * col * 1.25, 0.55 * (1.0 - u_intensity));
    col = col * (0.78 + 0.35 * diffuse(nf)) + vec3(1.0) * specular(n, 40.0) * 0.7;
    float sweep = mod(t * 1.0, boxW() + 4.0) - 2.0 + u_box.x / u_em;
    col += vec3(1.0) * exp(-pow((q.x + q.y * 0.5 - sweep) * 2.8, 2.0)) * 0.5;
    vec2 gq = q * 11.0;
    vec2 cell = floor(gq);
    float tw = pow(max(sin(t * 4.0 + hash(cell) * 60.0), 0.0), 16.0);
    col += vec3(1.0) * tw * smoothstep(0.2, 0.0, length(fract(gq) - 0.5)) * step(0.72, hash(cell + 1.0));
    col = mix(col, vec3(1.0), 0.35 * (1.0 - smoothstep(0.0, 0.7, sd)));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const GALAXY = `
float stars(vec2 q, float scale, float t, float threshold) {
  vec2 gq = q * scale;
  vec2 cell = floor(gq);
  vec2 sp = hash2(cell + u_seed);
  float d = length(fract(gq) - sp);
  float on = step(threshold, hash(cell + 4.0));
  float tw = 0.55 + 0.45 * sin(t * (1.5 + 3.0 * hash(cell)) + hash(cell + 1.0) * 30.0);
  return on * tw * smoothstep(0.09, 0.0, d);
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec4 res = pm(u_col[2], 0.35 * exp(-od / 0.12) * step(sd, 0.5));
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec2 center = boxCenter() / u_em;
    vec2 r = q - center;
    float ang = t * 0.05;
    r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * r;
    float n1 = fbm(r * 1.3 + vec2(t * 0.03, 0.0));
    float n2 = fbm(r * 2.4 - vec2(0.0, t * 0.05) + n1);
    vec3 col = mix(u_col[1], u_col[2], smoothstep(0.25, 0.75, n1));
    col += u_col[3] * smoothstep(0.4, 0.8, n2) * 0.9;
    col += u_col[4] * pow(smoothstep(0.45, 0.9, n1 * n2 * 1.8), 2.0) * 0.9;
    col += u_col[4] * smoothstep(0.55, 0.85, fbm3(r * 3.5 + 7.0)) * 0.45;
    col = mix(u_col[0], col, 0.35 + 0.65 * smoothstep(0.0, 0.6, n1 + n2 * 0.5));
    col += u_col[5] * (stars(r + vec2(t * 0.04, 0.0), 9.0, t, 0.82) + stars(r + vec2(t * 0.09, 0.0), 4.5, t, 0.9) * 1.4);
    vec3 n = bevelN(p, max(1.5, u_em * 0.08));
    col += u_col[5] * specular(n, 40.0) * 0.45;
    col += u_col[4] * 0.7 * (1.0 - smoothstep(0.0, 1.1, sd));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const VHS = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float tq = floor(t * 11.0);
  // Casi siempre se lee: fallos cortos y de vez en cuando uno grande.
  float burstChance = 0.04 + 0.08 * u_intensity;
  float burst = step(1.0 - burstChance, hash(vec2(tq, u_seed))) * 0.6;
  float big = step(0.93, fract(t / 3.7 + u_seed * 0.1));
  burst = max(burst, big);
  float band = floor(p.y / (0.15 * u_em));
  float shift = (hash(vec2(band, tq)) - 0.5) * 0.5 * u_em * burst * step(0.45, hash(vec2(band + 3.0, tq)));
  // Pista que se desliza (VHS): una franja que baja y tuerce la imagen.
  float roll = fract(t * 0.23);
  float rollY = mix(u_box.y - u_em, u_box.w + u_em, roll);
  float track = exp(-pow((p.y - rollY) / (0.12 * u_em), 2.0)) * u_intensity;
  shift += track * sin(p.y * 0.9 + t * 40.0) * 0.08 * u_em;
  shift += (noise(vec2(t * 28.0, band)) - 0.5) * 0.6;
  float ca = (0.8 + 2.6 * burst * u_intensity + track * 2.0) * u_em / 26.0 + 0.6;
  float r = clamp(sdAt(p + vec2(shift + ca, 0.0)) + 0.5, 0.0, 1.0);
  float g = clamp(sdAt(p + vec2(shift, 0.0)) + 0.5, 0.0, 1.0);
  float b = clamp(sdAt(p + vec2(shift - ca, 0.0)) + 0.5, 0.0, 1.0);
  vec3 col = u_col[0] * g + u_col[1] * r * (1.0 - g) + u_col[2] * b * (1.0 - g);
  float a = max(g, max(r, b) * 0.9);
  float scan = 0.8 + 0.2 * sin(p.y * 3.14159 / 1.5);
  col *= scan;
  col += vec3(1.0) * track * 0.25 * g;
  vec4 res = pm(col, a);
  // Nieve de cinta durante el fallo.
  vec2 blk = floor(p / vec2(5.0, 2.0));
  float snow = step(0.975, hash(blk + tq)) * burst * step(abs(p.y - (u_box.y + u_box.w) * 0.5), u_em * 0.6);
  res = over(pm(mix(u_col[3], vec3(1.0), hash(blk * 1.7 + tq)), snow * 0.85), res);
  float glow = exp(-max(-sdAt(p), 0.0) / u_em / 0.08) * 0.22;
  return over(res, pm(u_col[2], glow * step(sdAt(p), 0.0)));
}`;

const PLASMA = `
vec3 plasmaRamp(float x) {
  x = fract(x);
  vec3 c = mix(u_col[1], u_col[2], smoothstep(0.0, 0.4, x));
  c = mix(c, u_col[3], smoothstep(0.4, 0.7, x));
  return mix(c, u_col[1], smoothstep(0.7, 1.0, x));
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec4 res = vec4(0.0);
  if (sd < 0.5) {
    // Filamentos que escapan por los bordes.
    float ridge = 1.0 - abs(noise(q * vec2(9.0, 11.0) + vec2(t * 1.8, -t * 1.2)) * 2.0 - 1.0);
    float fil = pow(ridge, 14.0) * exp(-od / 0.09) * step(0.55, noise(q * 3.0 + t));
    res = pm(u_col[3], fil * 0.85);
    res = over(res, pm(u_col[2], 0.45 * exp(-od / 0.08) + 0.12 * exp(-od / 0.2)));
  }
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec2 cc = boxCenter() / u_em;
    float v = sin(q.x * 4.2 + t * 1.3) + sin(q.y * 5.0 - t * 1.1) + sin((q.x + q.y) * 3.1 + t * 0.7)
      + sin(length(q - cc + vec2(sin(t * 0.6), cos(t * 0.5)) * 1.5) * 6.0 - t * 2.2);
    vec3 col = plasmaRamp(v * 0.22 + t * 0.05);
    col = mix(col, u_col[4], smoothstep(2.2, 3.6, v) * 0.8);
    vec3 n = bevelN(p, max(1.5, u_em * 0.08));
    col = col * (0.6 + 0.5 * diffuse(n)) + u_col[4] * specular(n, 35.0) * 0.6;
    col += u_col[3] * 0.6 * (1.0 - smoothstep(0.0, 1.4, sd));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const CURSE = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec4 res = vec4(0.0);
  float pulse = 0.75 + 0.25 * sin(t * 2.4);
  // Llamas negras finas con borde violeta que suben desde las letras.
  if (sd < 0.5) {
    float above = aboveSoft(p);
    vec2 fq = vec2(q.x * 3.2, q.y * 1.6 + t * 1.5);
    float n = fbm(fq + vec2(fbm3(fq * 0.6 + t * 0.2) * 1.4 - 0.7, 0.0));
    float tongues = noise(vec2(q.x * 6.0, q.y * 1.1 + t * 2.2));
    float source = min(above / (0.2 + 0.22 * u_intensity), od / 0.06 + 0.5);
    float heat = n * 1.2 + tongues * 0.4 - source - 0.38;
    float body = smoothstep(0.0, 0.25, heat);
    float rim = smoothstep(-0.05, 0.05, heat) - smoothstep(0.05, 0.22, heat);
    vec3 col = mix(u_col[1], u_col[0], smoothstep(0.1, 0.5, heat));
    res = pm(col, body * 0.22);
    res = over(pm(u_col[3], rim * 0.9), res);
    res = over(res, pm(u_col[3], 0.4 * pulse * exp(-od / 0.08)));
  }
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec3 n = bevelN(p, max(1.5, u_em * 0.08));
    // Piel encendida en violeta…
    float glow = fbm3(q * 3.0 + vec2(0.0, -t * 0.4));
    vec3 col = mix(u_col[3], u_col[4], glow * 0.7) * (0.65 + 0.5 * diffuse(n)) + vec3(1.0) * specular(n, 40.0) * 0.35;
    // …y el sello que la invade en oleadas: llamas negras que avanzan.
    float wave = fract(t / 6.0 + u_seed * 0.07);
    float front = mix(u_box.x / u_em - 0.8, u_box.z / u_em + 0.8, smoothstep(0.0, 0.7, wave));
    float reveal = smoothstep(front + 0.2, front - 0.4, q.x + (fbm3(q * 4.0) - 0.5) * 0.7);
    float retreat = 1.0 - smoothstep(0.82, 1.0, wave);
    float ridge = 1.0 - abs(fbm(q * vec2(3.5, 5.0) + vec2(0.0, -t * 0.3)) * 2.0 - 1.0);
    float marks = smoothstep(0.84, 0.95, ridge) * reveal * retreat;
    col = mix(col, u_col[0], marks * 0.8);
    col = mix(u_col[1], col, smoothstep(0.0, max(1.4, u_em * 0.05), sd) * 0.75 + 0.25);
    res = over(pm(col * pulse + col * 0.25, inside), res);
  }
  return res;
}`;

const SHADOW = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float od = max(-sd, 0.0) / u_em;
  vec4 res = vec4(0.0);
  if (sd < 0.5) {
    float above = aboveSoft(p);
    vec2 sq = q * vec2(2.4, 1.7);
    float swirl = fbm3(sq * 0.8 + vec2(t * 0.12, t * 0.18));
    float dens = fbm(sq + vec2(swirl * 1.4, t * 0.55));
    float reach = max(exp(-od / 0.14), exp(-above / 0.5) * smoothstep(0.5, 0.0, od));
    float a = smoothstep(0.38, 0.75, dens) * reach;
    // Humo con bordes iluminados: oscuro por dentro, gris claro al borde.
    float lit = smoothstep(0.55, 0.38, dens);
    vec3 col = mix(u_col[0], u_col[2] * 1.9 + 0.08, lit * 0.8);
    res = pm(col, a * 0.92 * (0.6 + 0.4 * u_intensity));
    // Unos ojos aparecen en el humo de vez en cuando.
    float cycle = fract(t / 8.5 + u_seed * 0.31);
    float open = smoothstep(0.62, 0.68, cycle) * smoothstep(0.9, 0.84, cycle);
    float blink = step(0.015, abs(cycle - 0.77));
    vec2 eye = vec2(mix(u_box.x, u_box.z, 0.25 + 0.5 * hash(vec2(floor(t / 8.5), u_seed))), u_box.y - 0.26 * u_em) / u_em;
    vec2 d1 = (q - eye - vec2(-0.12, 0.0)) * vec2(1.0, 2.8);
    vec2 d2 = (q - eye - vec2(0.12, 0.0)) * vec2(1.0, 2.8);
    float eyes = smoothstep(0.07, 0.045, length(d1)) + smoothstep(0.07, 0.045, length(d2));
    float glowE = exp(-length(d1) / 0.07) + exp(-length(d2) / 0.07);
    res = over(pm(u_col[3], (eyes + glowE * 0.4) * open * blink), res);
  }
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    // La letra es humo condensado: gris claro con remolinos oscuros que se mueven.
    float churn = fbm(q * vec2(4.0, 3.0) + vec2(t * 0.3, -t * 0.5));
    vec3 col = mix(u_col[3] * 0.82, u_col[2], smoothstep(0.35, 0.75, churn) * 0.85);
    vec3 n = bevelN(p, max(1.5, u_em * 0.08));
    col = col * (0.7 + 0.4 * diffuse(n)) + u_col[3] * specular(n, 40.0) * 0.3;
    col = mix(u_col[0], col, smoothstep(0.0, max(1.2, u_em * 0.045), sd) * 0.8 + 0.2);
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const WELD = `
float torchX(float t) {
  float span = (u_box.z - u_box.x) + 0.8 * u_em;
  return u_box.x - 0.4 * u_em + fract(t / 3.4) * span;
}
vec3 heatRamp(float h) {
  vec3 c = mix(u_col[1], u_col[2], smoothstep(0.05, 0.35, h));
  c = mix(c, u_col[3], smoothstep(0.35, 0.7, h));
  return mix(c, u_col[4], smoothstep(0.75, 1.0, h));
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  float tx = torchX(t);
  vec2 torch = vec2(tx, boxCenter().y);
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec3 n = bevelN(p, max(1.5, u_em * 0.08));
    float brushed = noise(vec2(q.x * 40.0, q.y * 2.0));
    vec3 steel = mix(u_col[0], u_col[1], 0.4 + 0.5 * brushed);
    steel = steel * (0.5 + 0.7 * diffuse(n)) + vec3(0.9) * specular(n, 30.0) * 0.5;
    float behind = (tx - p.x) / u_em;
    float heat = behind > -0.08 ? exp(-max(behind, 0.0) * 1.5) : 0.0;
    heat *= 0.85 + 0.15 * noise(q * 6.0 + t);
    vec3 col = mix(steel, heatRamp(heat), smoothstep(0.04, 0.3, heat));
    res = pm(col, inside);
  }
  float d = length(p - torch) / u_em;
  float onBox = step(u_box.x - 0.3 * u_em, tx) * step(tx, u_box.z + 0.3 * u_em);
  float flick = 0.8 + 0.2 * noise(vec2(t * 30.0, 0.0));
  res = over(pm(u_col[4], (exp(-d / 0.07) + exp(-d / 0.3) * 0.45) * onBox * flick), res);
  // Chispas balísticas desde el soplete.
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float hk = hash(vec2(fi, u_seed + 11.0));
    float life = 0.45 + 0.4 * hash(vec2(fi, 2.0));
    float age = fract(t / life + hk * 5.0);
    float born = t - age * life;
    vec2 origin = vec2(torchX(born), boxCenter().y);
    vec2 v = vec2((hash(vec2(fi, floor(t / life + hk * 5.0))) - 0.5) * 2.4, -(0.5 + 1.3 * hash(vec2(fi + 3.0, floor(t / life + hk * 5.0))))) * u_em;
    float tau = age * life;
    vec2 pos = origin + v * tau + vec2(0.0, 4.0 * u_em) * tau * tau;
    vec2 vel = v + vec2(0.0, 8.0 * u_em) * tau;
    vec2 tail = pos - vel * 0.025;
    vec2 pa = p - tail;
    vec2 ba = pos - tail;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.01), 0.0, 1.0);
    float ds = length(pa - ba * h);
    float inRange = step(u_box.x - 0.3 * u_em, origin.x) * step(origin.x, u_box.z + 0.3 * u_em);
    float a = smoothstep(1.4, 0.3, ds) * (1.0 - age) * inRange;
    res = over(pm(mix(u_col[3], u_col[4], 1.0 - age), a), res);
  }
  return res;
}`;

const SPECTRUM = `
float level(float bar, float t) {
  float beat = 1.0 - fract(t * 2.0);
  float v = pow(noise(vec2(bar * 0.47, t * 2.7)), 1.2) * 0.85 + 0.15;
  return clamp(v * (0.78 + 0.32 * beat * beat), 0.05, 1.0);
}
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec2 c = colAt(p);
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    float bw = 0.12;
    float bar = floor(q.x / bw);
    float lv = level(bar, t);
    float peak = max(lv, max(level(bar, t - 0.15) - 0.05, max(level(bar, t - 0.3) - 0.12, level(bar, t - 0.45) - 0.22)));
    float frac = c.y / max(c.x + c.y, 0.01);
    float boxFrac = clamp((u_box.w - p.y) / max(u_box.w - u_box.y, 1.0), 0.0, 1.0);
    float hgt = mix(frac, boxFrac, 0.6);
    float lit = step(hgt, lv);
    float seg = step(fract(q.y / 0.11), 0.8);
    float gap = step(fract(q.x / bw), 0.84);
    vec3 led = mix(u_col[1], u_col[2], smoothstep(0.35, 0.65, hgt));
    led = mix(led, u_col[3], smoothstep(0.7, 0.9, hgt));
    vec3 col = mix(u_col[0] + led * 0.28, led * 1.25, lit * seg * gap);
    col = mix(col, vec3(1.0), smoothstep(0.05, 0.0, abs(hgt - peak)) * gap * 0.85);
    vec3 n = bevelN(p, max(1.4, u_em * 0.07));
    col += vec3(1.0) * specular(n, 40.0) * 0.25;
    res = pm(col, inside);
  }
  float od = max(-sd, 0.0) / u_em;
  res = over(res, pm(u_col[1], 0.28 * exp(-od / 0.1) * step(sd, 0.0)));
  return res;
}`;

const CODE_RAIN = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec4 res = vec4(0.0);
  float od = max(-sd, 0.0) / u_em;
  res = pm(u_col[2], 0.3 * exp(-od / 0.1) * step(sd, 0.0));
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    float cs = 0.12;
    vec2 cell = floor(q / cs);
    float hc = hash(vec2(cell.x, u_seed));
    float speed = 1.0 + hc * 1.6;
    float span = (u_box.w - u_box.y) / u_em + 1.4;
    float head = fract(t * speed * 0.3 + hc * 7.0) * span - 0.7;
    float yrel = q.y - u_box.y / u_em;
    float dist = head - yrel;
    float trail = dist >= 0.0 ? exp(-dist * 2.6) : 0.0;
    vec2 sub = floor(fract(q / cs) * vec2(3.0, 4.0));
    float glyph = step(0.42, hash(cell * 3.1 + sub + floor(t * 7.0 + hash(cell) * 9.0)));
    float headGlow = smoothstep(cs * 1.2, 0.0, abs(dist));
    vec3 col = u_col[1] * 1.15 + u_col[2] * 0.12;
    col = mix(col, u_col[2], trail * glyph);
    col = mix(col, u_col[3], headGlow * glyph);
    vec3 n = bevelN(p, max(1.4, u_em * 0.07));
    col += u_col[3] * specular(n, 40.0) * 0.2;
    col += u_col[2] * 0.4 * (1.0 - smoothstep(0.0, 1.0, sd));
    res = over(pm(col, inside), res);
  }
  return res;
}`;

const GROOVE = `
vec4 shade(vec2 p) {
  float t = u_time * u_speed;
  vec2 q = p / u_em;
  float sd = sdAt(p);
  vec4 res = vec4(0.0);
  if (sd > -1.0) {
    float inside = clamp(sd + 0.5, 0.0, 1.0);
    vec2 center = boxCenter();
    vec2 d = (p - center) / u_em;
    float r = length(d);
    float ang = atan(d.y, d.x);
    float grooves = 0.5 + 0.5 * sin(r * 105.0 + noise(vec2(r * 30.0, 0.0)) * 2.0);
    float sheen = pow(abs(cos(ang - t * 1.4)), 14.0);
    vec3 n = bevelN(p, max(1.6, u_em * 0.09));
    vec3 col = mix(u_col[0], u_col[1], grooves * 0.6);
    col += u_col[2] * sheen * (0.4 + 0.6 * grooves) * 1.2;
    col = col * (0.7 + 0.6 * diffuse(n)) + u_col[3] * specular(n, 30.0) * 0.8;
    col = mix(u_col[2] * 1.2, col, smoothstep(0.0, max(1.2, u_em * 0.04), sd) * 0.7 + 0.3);
    res = pm(col, inside);
  }
  float od = max(-sd, 0.0) / u_em;
  return over(res, pm(u_col[4], 0.35 * exp(-od / 0.07) * step(sd, 0.0)));
}`;

const BODIES: Readonly<Record<string, string>> = {
  "blood-flow": BLOOD,
  "fire-burn": FIRE,
  "lightning-arc": LIGHTNING,
  "neon-tube": NEON,
  "liquid-gold": GOLD,
  frost: FROST,
  "snow-cap": SNOW,
  acid: ACID,
  "holo-foil": HOLO,
  galaxy: GALAXY,
  "vhs-glitch": VHS,
  "plasma-core": PLASMA,
  "curse-mark": CURSE,
  "shadow-smoke": SHADOW,
  weld: WELD,
  spectrum: SPECTRUM,
  "code-rain": CODE_RAIN,
  groove: GROOVE,
};

export const NAME_SHADER_KEYS = Object.keys(BODIES);

export function isNameShader(preset: string | undefined): boolean {
  return Boolean(preset && preset in BODIES);
}

/** Fuente completa del fragment shader de un preset (null si no existe). */
export function nameShaderSource(preset: string): string | null {
  const body = BODIES[preset];
  if (!body) return null;
  return `${COMMON}\n${body}\nvoid main() {\n  vec2 p = v_uv * u_res;\n  float edge = min(min(p.x, u_res.x - p.x), min(p.y, u_res.y - p.y));\n  gl_FragColor = shade(p) * smoothstep(0.0, 0.22 * u_em, edge);\n}\n`;
}

/** Cuánto sale cada material de la caja del texto (en em): arriba, abajo, lados. */
export function shaderPadding(preset: string): { top: number; bottom: number; side: number } {
  switch (preset) {
    case "blood-flow":
    case "liquid-gold":
    case "acid":
      return { top: 0.45, bottom: 1.15, side: 0.35 };
    case "fire-burn":
    case "curse-mark":
    case "shadow-smoke":
      return { top: 0.95, bottom: 0.35, side: 0.4 };
    case "snow-cap":
      return { top: 0.75, bottom: 0.45, side: 0.3 };
    case "frost":
      return { top: 0.4, bottom: 0.8, side: 0.35 };
    case "weld":
      return { top: 0.9, bottom: 0.9, side: 0.6 };
    case "lightning-arc":
      return { top: 0.6, bottom: 0.6, side: 0.4 };
    default:
      return { top: 0.45, bottom: 0.45, side: 0.35 };
  }
}
