"use client";

import { useEffect, useState } from "react";

// Tiny dependency-free celebratory confetti burst.
// Renders only after mount so Math.random() never runs during SSR (no hydration mismatch).
const COLORS = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f472b6"];

export function Confetti({ count = 42 }: { count?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: COLORS[i % COLORS.length],
            width: 5 + Math.random() * 6,
            height: (5 + Math.random() * 6) * 1.4,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animationDelay: `${Math.random() * 0.5}s`,
            ["--dur" as string]: `${1.6 + Math.random() * 1.3}s`,
            ["--fall" as string]: `${120 + Math.random() * 160}px`,
            ["--sway" as string]: `${-60 + Math.random() * 120}px`,
          }}
        />
      ))}
    </div>
  );
}