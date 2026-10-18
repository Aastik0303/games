"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion, useDeviceSettings } from "@/lib/settings";
import { createScene, createSprites, renderScene, resizeScene, stepScene, type Scene, type View } from "./crystal-field";

const MAX_DPR = 1.5;

/**
 * Fixed, decorative backdrop for every page: near-black space with slowly
 * drifting, rotating glass crystals, faint stars and dust. Under reduced
 * motion it renders a single still frame.
 */
export function PrismBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useDeviceSettings();
  const reduce = prefersReducedMotion(settings);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const sprites = createSprites();
    const view: View = { px: 0, py: 0, scrollY: window.scrollY };
    const target = { x: 0, y: 0 };
    let scene: Scene | null = null;
    let frame = 0;
    let last = 0;
    let elapsed = 0;

    const draw = () => scene && renderScene(ctx, scene, sprites, elapsed, view);

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Rebuild on big changes (rotation, new window); otherwise keep the crystals in place.
      if (!scene || Math.abs(w * h - scene.width * scene.height) / (scene.width * scene.height) > 0.35) scene = createScene(w, h);
      else resizeScene(scene, w, h);
      draw();
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      elapsed += dt;
      view.px += (target.x - view.px) * 0.04;
      view.py += (target.y - view.py) * 0.04;
      view.scrollY += (window.scrollY - view.scrollY) * 0.12;
      if (scene) stepScene(scene, dt);
      draw();
      frame = requestAnimationFrame(tick);
    };

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [reduce]);

  return (
    <div className="prism-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="prism-bg__canvas" />
    </div>
  );
}
