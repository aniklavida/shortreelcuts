"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Sun, Moon, Video, Plus } from "lucide-react";

export function Shell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const currentTheme = (document.documentElement.getAttribute("data-theme") as "dark" | "light") || "dark";
    setTheme(currentTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    try {
      localStorage.setItem("shortreelcuts-theme", nextTheme);
    } catch {}
  };

  return (
    <div className="shell">
      <header className="shell-header" role="banner">
        <Link href="/" className="shell-wordmark" aria-label="ShortReelCuts home">
          <Video size={20} strokeWidth={2} style={{ color: "var(--acc)", flexShrink: 0 }} aria-hidden="true" />
          <span className="wordmark-text">ShortReelCuts</span>
        </Link>

        <nav className="shell-nav" aria-label="Main navigation">
          <Link href="/" className="btn btn-ghost btn-sm" aria-label="New video prompt">
            <Plus size={16} aria-hidden="true" />
            <span className="nav-text">New video</span>
          </Link>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost btn-sm"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {mounted && theme === "light" ? (
              <Moon size={16} aria-hidden="true" />
            ) : (
              <Sun size={16} aria-hidden="true" />
            )}
            <span className="nav-text" style={{ fontSize: 12 }}>
              {mounted ? (theme === "dark" ? "Light" : "Dark") : "Theme"}
            </span>
          </button>
        </nav>
      </header>

      <main className="shell-main" role="main">
        {children}
      </main>

      <footer className="shell-footer" role="contentinfo">
        <div>
          <strong style={{ color: "var(--ink)" }}>ShortReelCuts</strong> · Self-hosted prompt-to-video generator with an open decision sheet.
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <span>Deterministic seed pipeline</span>
          <span>Zero cloud dependency</span>
        </div>
      </footer>
    </div>
  );
}
