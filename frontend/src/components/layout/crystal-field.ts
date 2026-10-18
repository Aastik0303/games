/**
 * Floating-crystal backdrop: a tiny flat-shaded 3D renderer on a 2D canvas.
 * Each crystal is a low-poly bipyramid (diamond, quartz or flat glass shard)
 * lit by one soft key light; back facets are drawn faintly through the front
 * ones so the shards read as translucent glass. Pure functions only — the
 * React component owns the canvas, the loop and cleanup.
 */

type Rand = () => number;
type Rgb = readonly [number, number, number];

export interface Crystal {
  /** Model-space vertices (x, y, z triples), max radius 1. */
  verts: Float32Array;
  /** Triangle indices, wound so normals point outward. */
  faces: Uint16Array;
  x: number;
  y: number;
  /** 0 = far away, 1 = closest. Drives size, speed and parallax. */
  depth: number;
  size: number;
  vx: number;
  vy: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  /** 0..1 — most crystals are dim, a few catch the light. */
  illum: number;
  tint: string;
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
  /** Slow shine pulse (rad/s) that peaks in a brief white flare. */
  shineFreq: number;
  shinePhase: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  depth: number;
  twinkle: number; // 0 = steady, otherwise angular frequency
  phase: number;
  /** Bright enough to show starburst spikes instead of a plain dot. */
  spark: boolean;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  a: number;
  vx: number;
  vy: number;
  depth: number;
}

export interface Scene {
  width: number;
  height: number;
  crystals: Crystal[];
  stars: Star[];
  motes: Mote[];
}

export interface View {
  /** Smoothed pointer offset, -1..1 on each axis. */
  px: number;
  py: number;
  scrollY: number;
}

const TINTS: { rgb: Rgb; weight: number }[] = [
  { rgb: [244, 248, 255], weight: 0.55 }, // cosmic white
  { rgb: [208, 228, 255], weight: 0.33 }, // icy blue
  { rgb: [222, 214, 255], weight: 0.12 }, // faint violet
];

// Key light from upper left, slightly in front (screen y points down, +z towards the viewer).
const L = normalize([-0.45, -0.65, 0.62]);
const H = normalize([L[0], L[1], L[2] + 1]); // half-vector with the view direction (0,0,1)
// Cool fill light from the lower right gives the icy-blue reflections.
const L2 = normalize([0.6, 0.55, 0.45]);
const ICE = "rgb(130 185 255)";
const EDGE = "rgb(246 249 255)";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function pickTint(rand: Rand): Rgb {
  let r = rand();
  for (const t of TINTS) {
    if ((r -= t.weight) <= 0) return t.rgb;
  }
  return TINTS[0].rgb;
}

/**
 * Builds a jittered bipyramid: one ring (diamond / shard) or two rings
 * (elongated quartz point) between two apexes.
 */
export function makeCrystalGeometry(rand: Rand): { verts: Float32Array; faces: Uint16Array } {
  const kind = rand();
  const flat = kind > 0.78; // thin glass fragment
  const quartz = !flat && kind < 0.4;
  const n = 3 + Math.floor(rand() * (flat ? 2 : 4)); // 3..6 sides
  const sx = 0.55 + rand() * 0.5;
  const sz = flat ? 0.18 + rand() * 0.2 : 0.55 + rand() * 0.45;
  const halfLen = quartz ? 0.35 + rand() * 0.7 : 0;
  const rings = quartz ? [-halfLen, halfLen] : [0];

  const v: number[] = [];
  const jitter = () => (rand() - 0.5) * 0.25;
  v.push(jitter(), -(halfLen + 0.55 + rand() * 0.9), jitter()); // top apex = 0
  v.push(jitter(), halfLen + 0.35 + rand() * 0.6, jitter()); // bottom apex = 1
  const twist = rand() * Math.PI * 2;
  for (const ringY of rings) {
    for (let i = 0; i < n; i++) {
      const a = twist + ((i + (rand() - 0.5) * 0.5) / n) * Math.PI * 2;
      const r = 0.5 + rand() * 0.45;
      v.push(Math.cos(a) * r * sx, ringY + (rand() - 0.5) * 0.12, Math.sin(a) * r * sz);
    }
  }

  const ring = (k: number, i: number) => 2 + k * n + (i % n);
  const f: number[] = [];
  for (let i = 0; i < n; i++) {
    f.push(0, ring(0, i), ring(0, i + 1));
    if (quartz) {
      f.push(ring(0, i), ring(1, i), ring(1, i + 1));
      f.push(ring(0, i), ring(1, i + 1), ring(0, i + 1));
    }
    const last = rings.length - 1;
    f.push(1, ring(last, i + 1), ring(last, i));
  }

  // Normalise to unit radius.
  let max = 0;
  for (let i = 0; i < v.length; i += 3) max = Math.max(max, Math.hypot(v[i], v[i + 1], v[i + 2]));
  for (let i = 0; i < v.length; i++) v[i] /= max;

  // Wind every face outward (the shape is star-shaped around the origin).
  for (let i = 0; i < f.length; i += 3) {
    const [a, b, c] = [f[i] * 3, f[i + 1] * 3, f[i + 2] * 3];
    const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
    const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const cx = v[a] + v[b] + v[c];
    const cy = v[a + 1] + v[b + 1] + v[c + 1];
    const cz = v[a + 2] + v[b + 2] + v[c + 2];
    if (nx * cx + ny * cy + nz * cz < 0) [f[i + 1], f[i + 2]] = [f[i + 2], f[i + 1]];
  }

  return { verts: new Float32Array(v), faces: new Uint16Array(f) };
}

/** Dense enough to fill the whole viewport with shards, scaling with its area. */
export function crystalCount(width: number, height: number): number {
  return clamp(Math.round((width * height) / 20000), 16, 80);
}

/**
 * Jittered-grid positions so crystals spread evenly over the screen instead of
 * clumping the way pure random placement does.
 */
function spreadPositions(n: number, width: number, height: number, rand: Rand): [number, number][] {
  const cols = Math.max(1, Math.round(Math.sqrt((n * width) / height)));
  const rows = Math.ceil(n / cols);
  const cw = width / cols;
  const ch = height / rows;
  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, n).map((cell) => [((cell % cols) + 0.1 + rand() * 0.8) * cw, (Math.floor(cell / cols) + 0.1 + rand() * 0.8) * ch]);
}

export function createScene(width: number, height: number, rand: Rand = Math.random): Scene {
  const area = width * height;
  const crystals: Crystal[] = [];
  const n = crystalCount(width, height);
  const spots = spreadPositions(n, width, height, rand);
  for (let i = 0; i < n; i++) {
    const depth = rand() ** 1.4; // mostly distant, a few close
    const { verts, faces } = makeCrystalGeometry(rand);
    // Tiny crystals wander across the screen; big shards barely move.
    const speed = lerp(9, 0.5, depth) * (0.5 + rand());
    const heading = rand() * Math.PI * 2;
    const spin = lerp(0.45, 0.05, depth);
    const lit = rand() < 0.35;
    const rgb = pickTint(rand);
    crystals.push({
      verts,
      faces,
      x: spots[i][0],
      y: spots[i][1],
      depth,
      size: lerp(5, 54, depth ** 1.5) * (0.75 + rand() * 0.5),
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      rx: rand() * Math.PI * 2,
      ry: rand() * Math.PI * 2,
      rz: rand() * Math.PI * 2,
      wx: spin * (rand() - 0.5) * 2,
      wy: spin * (rand() - 0.5) * 2,
      wz: spin * (rand() - 0.5),
      illum: (lit ? 0.8 + rand() * 0.2 : 0.3 + rand() * 0.35) * (0.7 + 0.3 * depth),
      tint: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
      bobAmp: lerp(1.5, 7, depth) * rand(),
      bobFreq: 0.08 + rand() * 0.18,
      bobPhase: rand() * Math.PI * 2,
      shineFreq: 0.25 + rand() * 0.9,
      shinePhase: rand() * Math.PI * 2,
    });
  }
  // Far first so near crystals paint over them.
  crystals.sort((a, b) => a.depth - b.depth);

  const stars: Star[] = Array.from({ length: clamp(Math.round(area / 9000), 50, 200) }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: 0.25 + rand() ** 3 * 0.9,
    a: 0.12 + rand() ** 2 * 0.5,
    depth: rand() * 0.15,
    twinkle: rand() < 0.3 ? 0.4 + rand() * 1.4 : 0,
    phase: rand() * Math.PI * 2,
    spark: rand() < 0.2,
  }));

  const motes: Mote[] = Array.from({ length: clamp(Math.round(area / 55000), 8, 32) }, () => {
    const a = rand() * Math.PI * 2;
    const s = 2 + rand() * 5;
    return {
      x: rand() * width,
      y: rand() * height,
      r: 0.5 + rand() * 1.2,
      a: 0.04 + rand() * 0.1,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      depth: 0.2 + rand() * 0.6,
    };
  });

  return { width, height, crystals, stars, motes };
}

/** Rescale positions after a small resize instead of regenerating the scene. */
export function resizeScene(scene: Scene, width: number, height: number): void {
  const kx = width / scene.width;
  const ky = height / scene.height;
  for (const list of [scene.crystals, scene.stars, scene.motes]) {
    for (const p of list) {
      p.x *= kx;
      p.y *= ky;
    }
  }
  scene.width = width;
  scene.height = height;
}

const wrap = (v: number, size: number, margin: number) => {
  const span = size + margin * 2;
  return ((((v + margin) % span) + span) % span) - margin;
};

/** Advance the simulation by dt seconds. */
export function stepScene(scene: Scene, dt: number): void {
  const { width, height } = scene;
  for (const c of scene.crystals) {
    const m = c.size * 2;
    c.x = wrap(c.x + c.vx * dt, width, m);
    c.y = wrap(c.y + c.vy * dt, height, m);
    c.rx += c.wx * dt;
    c.ry += c.wy * dt;
    c.rz += c.wz * dt;
  }
  for (const p of scene.motes) {
    p.x = wrap(p.x + p.vx * dt, width, 4);
    p.y = wrap(p.y + p.vy * dt, height, 4);
  }
}

export interface Sprites {
  glow: HTMLCanvasElement;
  glint: HTMLCanvasElement;
}

/**
 * Pre-rendered soft glow and photographic starburst, drawn with additive
 * blending. The starburst mimics a camera catching a hot point of light:
 * a blown-out core, bloom, and thin diffraction spikes (long vertical,
 * shorter horizontal, faint diagonals) that fall off sharply from the centre.
 */
export function createSprites(): Sprites {
  const S = 128;
  const glow = document.createElement("canvas");
  glow.width = glow.height = S;
  const g = glow.getContext("2d")!;
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "rgb(255 255 255 / 0.8)");
  rg.addColorStop(0.12, "rgb(240 246 255 / 0.4)");
  rg.addColorStop(0.35, "rgb(210 225 255 / 0.12)");
  rg.addColorStop(1, "rgb(190 210 255 / 0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);

  const G = 256;
  const c = G / 2;
  const glint = document.createElement("canvas");
  glint.width = glint.height = G;
  const k = glint.getContext("2d")!;
  k.globalCompositeOperation = "lighter";

  const spike = (len: number, thick: number, alpha: number, angle: number) => {
    k.save();
    k.translate(c, c);
    k.rotate(angle);
    const lg = k.createLinearGradient(-len, 0, len, 0);
    for (const [at, a] of [
      [0, 0],
      [0.3, 0.06],
      [0.42, 0.25],
      [0.48, 0.7],
      [0.5, 1],
    ] as const) {
      lg.addColorStop(at, `rgb(255 252 246 / ${a * alpha})`);
      lg.addColorStop(1 - at, `rgb(255 252 246 / ${a * alpha})`);
    }
    k.fillStyle = lg;
    // Tapered needle: widest at the core, a hairline at the tips.
    k.beginPath();
    k.moveTo(-len, 0);
    k.lineTo(0, -thick);
    k.lineTo(len, 0);
    k.lineTo(0, thick);
    k.closePath();
    k.fill();
    k.restore();
  };
  spike(c, 3, 1, Math.PI / 2);
  spike(c * 0.55, 2.4, 0.75, 0);
  spike(c * 0.25, 1.4, 0.3, Math.PI / 4);
  spike(c * 0.25, 1.4, 0.3, -Math.PI / 4);

  const bloom = k.createRadialGradient(c, c, 0, c, c, c * 0.32);
  bloom.addColorStop(0, "rgb(255 255 255 / 1)");
  bloom.addColorStop(0.08, "rgb(255 253 249 / 0.95)");
  bloom.addColorStop(0.22, "rgb(250 244 238 / 0.35)");
  bloom.addColorStop(0.55, "rgb(235 230 230 / 0.07)");
  bloom.addColorStop(1, "rgb(230 230 240 / 0)");
  k.fillStyle = bloom;
  k.fillRect(0, 0, G, G);

  return { glow, glint };
}

// Scratch buffers shared by every crystal draw (max 2 rings × 6 + 2 apexes).
const TX = new Float32Array(16);
const TY = new Float32Array(16);
const TZ = new Float32Array(16);
const FN = new Float32Array(64 * 3);
const FZ = new Float32Array(64);
const ORDER: number[] = [];

function drawCrystal(ctx: CanvasRenderingContext2D, c: Crystal, cx: number, cy: number, sprites: Sprites, t: number) {
  const { verts, faces, size, illum } = c;
  // Rotation matrix R = Rz · Ry · Rx.
  const sx = Math.sin(c.rx), cxr = Math.cos(c.rx);
  const sy = Math.sin(c.ry), cyr = Math.cos(c.ry);
  const sz = Math.sin(c.rz), czr = Math.cos(c.rz);
  const m00 = czr * cyr, m01 = czr * sy * sx - sz * cxr, m02 = czr * sy * cxr + sz * sx;
  const m10 = sz * cyr, m11 = sz * sy * sx + czr * cxr, m12 = sz * sy * cxr - czr * sx;
  const m20 = -sy, m21 = cyr * sx, m22 = cyr * cxr;

  const nv = verts.length / 3;
  for (let i = 0; i < nv; i++) {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    TX[i] = m00 * x + m01 * y + m02 * z;
    TY[i] = m10 * x + m11 * y + m12 * z;
    TZ[i] = m20 * x + m21 * y + m22 * z;
  }

  const nf = faces.length / 3;
  ORDER.length = 0;
  for (let f = 0; f < nf; f++) {
    const a = faces[f * 3], b = faces[f * 3 + 1], d = faces[f * 3 + 2];
    const e1x = TX[b] - TX[a], e1y = TY[b] - TY[a], e1z = TZ[b] - TZ[a];
    const e2x = TX[d] - TX[a], e2y = TY[d] - TY[a], e2z = TZ[d] - TZ[a];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    FN[f * 3] = nx; FN[f * 3 + 1] = ny; FN[f * 3 + 2] = nz;
    FZ[f] = TZ[a] + TZ[b] + TZ[d];
    ORDER.push(f);
  }
  ORDER.sort((p, q) => FZ[p] - FZ[q]); // back to front

  // Every crystal breathes a soft white glow; at the top of the pulse it flares.
  const pulse = 0.5 + 0.5 * Math.sin(t * c.shineFreq + c.shinePhase);
  const flare = pulse ** 14;
  {
    const r = size * (2.4 + 1.4 * pulse);
    ctx.globalAlpha = Math.min(1, (0.1 + 0.3 * illum) * (0.55 + 0.45 * pulse));
    ctx.drawImage(sprites.glow, cx - r, cy - r, r * 2, r * 2);
  }

  ctx.fillStyle = c.tint;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(0.5, size * 0.018);
  ctx.lineJoin = "round";
  let best = 0, bestX = cx, bestY = cy;

  for (const f of ORDER) {
    const a = faces[f * 3], b = faces[f * 3 + 1], d = faces[f * 3 + 2];
    const nx = FN[f * 3], ny = FN[f * 3 + 1], nz = FN[f * 3 + 2];
    const ax = cx + TX[a] * size, ay = cy + TY[a] * size;
    const bx = cx + TX[b] * size, by = cy + TY[b] * size;
    const dx = cx + TX[d] * size, dy = cy + TY[d] * size;
    const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const rim = (1 - Math.abs(nz)) ** 2;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(dx, dy);
    ctx.closePath();

    if (nz <= 0) {
      // Back facet, seen through the glass: faint body and inner edges.
      ctx.globalAlpha = (0.025 + rim * 0.05) * illum;
      ctx.fill();
      ctx.globalAlpha = 0.07 * illum;
      ctx.stroke();
      continue;
    }

    const diff2 = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
    const spec = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]) ** 24;
    ctx.globalAlpha = (0.05 + diff * 0.34 + rim * 0.16) * illum * (0.8 + 0.2 * pulse);
    ctx.fill();
    if (diff2 > 0.25) {
      ctx.fillStyle = ICE;
      ctx.globalAlpha = diff2 * diff2 * 0.2 * illum;
      ctx.fill();
      ctx.fillStyle = c.tint;
    }
    if (spec > 0.04) {
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = Math.min(0.95, spec * 1.1 * illum);
      ctx.fill();
      ctx.fillStyle = c.tint;
    }
    ctx.globalAlpha = Math.min(1, (0.12 + 0.5 * diff + 0.35 * rim + 0.6 * spec) * illum);
    ctx.stroke();

    if (spec > best) {
      best = spec;
      bestX = (ax + bx + dx) / 3;
      bestY = (ay + by + dy) / 3;
    }
  }

  // Starburst: brighter crystals always sparkle a little, and flare when a facet
  // turns towards the light or at the top of their shine pulse.
  const steady = clamp((illum - 0.35) * 0.9, 0, 0.5) * (0.7 + 0.3 * pulse);
  const shine = Math.max(steady, (best - 0.45) * 1.8, flare * (0.4 + 0.6 * illum));
  if (shine > 0.02 && size > 3) {
    const r = size * (1.4 + 2.4 * shine);
    ctx.globalAlpha = Math.min(1, shine * (0.5 + 0.5 * illum));
    ctx.drawImage(sprites.glint, bestX - r, bestY - r, r * 2, r * 2);
  }
}

/** Draw one frame. `t` is elapsed seconds (drives bobbing and twinkle). */
export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, sprites: Sprites, t: number, view: View): void {
  const { width, height } = scene;
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";

  // Parallax: deeper layers shift less with the pointer and with scrolling.
  const shift = (depth: number) => [view.px * depth * 22, view.py * depth * 16 - view.scrollY * depth * 0.06] as const;

  ctx.fillStyle = "#e8efff";
  for (const s of scene.stars) {
    const [ox, oy] = shift(s.depth);
    const tw = s.twinkle ? 0.55 + 0.45 * Math.sin(t * s.twinkle + s.phase) : 1;
    ctx.globalAlpha = s.a * tw;
    const x = wrap(s.x + ox, width, 2);
    const y = wrap(s.y + oy, height, 2);
    if (s.spark) {
      // Distant sparkle: a tiny starburst rather than a dot.
      const r = 6 + s.r * 14 * tw;
      ctx.globalAlpha = Math.min(1, s.a * tw * 1.6);
      ctx.drawImage(sprites.glint, x - r, y - r, r * 2, r * 2);
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#b9cdf5";
  for (const p of scene.motes) {
    const [ox, oy] = shift(p.depth);
    ctx.globalAlpha = p.a;
    ctx.beginPath();
    ctx.arc(wrap(p.x + ox, width, 4), wrap(p.y + oy, height, 4), p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const c of scene.crystals) {
    const [ox, oy] = shift(c.depth);
    const m = c.size * 2;
    const x = wrap(c.x + ox, width, m);
    const y = wrap(c.y + oy + Math.sin(t * c.bobFreq + c.bobPhase) * c.bobAmp, height, m);
    drawCrystal(ctx, c, x, y, sprites, t);
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
