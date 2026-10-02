import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
const KEY = "theme.mode";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Toggles the `dark` class on <html> (Tailwind's `dark:` variant keys off it) and the native color-scheme. */
export function applyTheme(mode: ThemeMode = getThemeMode()) {
  const dark = mode === "dark" || (mode === "system" && mq().matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
  applyTheme(mode);
}

/** Apply the stored theme and follow OS changes while in "system" mode. */
export function initTheme() {
  applyTheme();
  mq().addEventListener("change", () => {
    if (getThemeMode() === "system") applyTheme("system");
  });
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  useEffect(() => setThemeMode(mode), [mode]);
  return [mode, setMode];
}
