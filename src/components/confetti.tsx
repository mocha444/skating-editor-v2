"use client";

import { useMemo } from "react";

// Tiny dependency-free celebratory confetti burst.
// Pre-generates every piece's position/size once so Math.random() never
// runs during render.
const COLORS = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f472b6"];

interface ConfettiPiece {
  left: number;
  backgroundColor: string;
  width: number;
  height: number;
  borderRadius: string;
  animationDelay: string;
  dur: string;
  fall: string;
  sway: string;
}

function generatePieces(count: number): ConfettiPiece[] {
  return Array.from({ length: count }, () => ({
    left: Math.random() * 100,
    backgroundColor: COLORS[Math.floor(Math.random() * COLORS.length)],
    width: 5 + Math.random() * 6,
    height: (5 + Math.random() * 6) * 1.4,
    borderRadius: Math.random() > 0.5 ? "50%" : "2px",
    animationDelay: `${Math.random() * 0.5}s`,
    dur: `${1.6 + Math.random() * 1.3}s`,
    fall: `${120 + Math.random() * 160}px`,
    sway: `${-60 + Math.random() * 120}px`,
  }));
}

export function Confetti({ count = 42 }: { count?: number }) {
  const pieces = useMemo(() => generatePieces(count), [count]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.backgroundColor,
            width: p.width,
            height: p.height,
            borderRadius: p.borderRadius,
            animationDelay: p.animationDelay,
            "--dur": p.dur,
            "--fall": p.fall,
            "--sway": p.sway,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
