"use client";

import { useEffect, useRef } from "react";

type ShaderAnimationProps = {
  color?: string;
  className?: string;
};

function toRgb(color: string) {
  const normalized = color.replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized, 16);
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

export function ShaderAnimation({
  color = "#22c55e",
  className = "",
}: ShaderAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const rgb = toRgb(color);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    };

    const paint = (timestamp: number) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const centerX = width * 0.78;
      const centerY = height * 0.16;
      const glow = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(width, height) * 0.72,
      );
      glow.addColorStop(0, `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 0.13)`);
      glow.addColorStop(0.5, `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 0.035)`);
      glow.addColorStop(1, `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 0)`);
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      context.lineCap = "round";
      context.globalCompositeOperation = "lighter";
      const maxRadius = Math.max(width, height) * 0.78;

      for (let index = 0; index < 6; index += 1) {
        const phase = ((timestamp * 0.000035) + index / 6) % 1;
        const radius = 24 + phase * maxRadius;
        const alpha = Math.sin(Math.PI * phase) * 0.14;
        context.beginPath();
        context.strokeStyle = `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${alpha})`;
        context.lineWidth = index % 2 === 0 ? 1.15 : 0.7;
        context.arc(
          centerX,
          centerY,
          radius,
          -1.15 + phase * 0.5,
          2.5 + phase * 0.85,
        );
        context.stroke();
      }

      context.globalCompositeOperation = "source-over";
    };

    const animate = (timestamp: number) => {
      paint(timestamp);
      frameId = window.requestAnimationFrame(animate);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion.matches) paint(0);
    });
    observer.observe(canvas);
    resize();

    if (reducedMotion.matches) {
      paint(0);
    } else {
      frameId = window.requestAnimationFrame(animate);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [color]);

  return (
    <canvas
      ref={canvasRef}
      className={`shader-lines ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
