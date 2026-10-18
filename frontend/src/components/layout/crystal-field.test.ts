import { describe, expect, it } from "vitest";
import { createScene, crystalCount, makeCrystalGeometry, stepScene } from "./crystal-field";

/** Small deterministic PRNG (mulberry32) so failures reproduce. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("crystal geometry", () => {
  it("winds every face outward and fits in the unit sphere", () => {
    const rand = seeded(7);
    for (let k = 0; k < 200; k++) {
      const { verts: v, faces: f } = makeCrystalGeometry(rand);
      expect(v.length / 3).toBeLessThanOrEqual(16); // scratch buffer size
      expect(f.length / 3).toBeLessThanOrEqual(64);
      for (let i = 0; i < v.length; i += 3) expect(Math.hypot(v[i], v[i + 1], v[i + 2])).toBeLessThanOrEqual(1 + 1e-6);
      for (let i = 0; i < f.length; i += 3) {
        const [a, b, c] = [f[i] * 3, f[i + 1] * 3, f[i + 2] * 3];
        const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
        const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const centroid = [v[a] + v[b] + v[c], v[a + 1] + v[b + 1] + v[c + 1], v[a + 2] + v[b + 2] + v[c + 2]];
        expect(n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("crystal scene", () => {
  it("scales density with the viewport, within bounds", () => {
    expect(crystalCount(390, 844)).toBe(16);
    expect(crystalCount(1600, 900)).toBe(72);
    expect(crystalCount(3840, 2160)).toBe(80);
  });

  it("spreads crystals over every part of the screen", () => {
    const scene = createScene(1600, 900, seeded(11));
    const quadrants = new Set(scene.crystals.map((c) => (c.x < 800 ? 0 : 1) + (c.y < 450 ? 0 : 2)));
    expect(quadrants.size).toBe(4);
    for (const c of scene.crystals) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(1600);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(900);
    }
  });

  it("draws far crystals first and keeps everything near the viewport while drifting", () => {
    const scene = createScene(800, 600, seeded(3));
    const depths = scene.crystals.map((c) => c.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    for (let i = 0; i < 2000; i++) stepScene(scene, 0.05);
    for (const c of scene.crystals) {
      expect(c.x).toBeGreaterThanOrEqual(-c.size * 2);
      expect(c.x).toBeLessThanOrEqual(800 + c.size * 2);
      expect(c.y).toBeGreaterThanOrEqual(-c.size * 2);
      expect(c.y).toBeLessThanOrEqual(600 + c.size * 2);
    }
  });
});
