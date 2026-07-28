"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

type Mode = "light" | "dark";

/**
 * Applies the theme class directly.
 *
 * next-themes applies it from an effect, and a view transition snapshots the
 * DOM the moment its callback returns — so relying on that effect having run
 * is a race. Setting the class here makes the snapshot correct no matter when
 * the library catches up; it writes the same value, so it is idempotent.
 */
function applyThemeClass(mode: Mode): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  root.style.colorScheme = mode;
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  function toggle() {
    const next: Mode = resolvedTheme === "dark" ? "light" : "dark";

    // Typed in the DOM lib but not shipped by every browser, so the guard is a
    // runtime one. Firefox before 129 and older Safari fall through to an
    // instant switch — the same behaviour as before this animation existed.
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (typeof document.startViewTransition !== "function" || prefersReducedMotion) {
      setTheme(next);
      return;
    }

    // Expand the reveal from the button itself, out to whichever screen corner
    // is furthest away, so the circle always covers the whole viewport.
    const rect = buttonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : 0;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const root = document.documentElement;
    root.style.setProperty("--theme-x", `${x}px`);
    root.style.setProperty("--theme-y", `${y}px`);
    root.style.setProperty("--theme-r", `${radius}px`);

    document.startViewTransition(() => {
      // flushSync so React has committed before the snapshot is taken.
      flushSync(() => setTheme(next));
      applyThemeClass(next);
    });
  }

  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={toggle}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
