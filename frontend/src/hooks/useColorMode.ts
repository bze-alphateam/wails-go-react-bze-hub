import { useState, useEffect } from "react";
import { notifyThemeChanged } from "./useBridgeHandler";

export type ColorMode = "light" | "dark";

const STORAGE_KEY = "bze-hub-color-mode";

function getInitialMode(): ColorMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  // Respect system preference
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function applyMode(mode: ColorMode) {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(mode);
  document.documentElement.style.colorScheme = mode;
}

export function useColorMode() {
  const [colorMode, setColorModeState] = useState<ColorMode>(getInitialMode);

  useEffect(() => {
    applyMode(colorMode);
  }, [colorMode]);

  const setColorMode = (mode: ColorMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    setColorModeState(mode);
    // Sync to dApp iframes
    notifyThemeChanged(mode);
  };

  const toggleColorMode = () => {
    setColorMode(colorMode === "light" ? "dark" : "light");
  };

  return { colorMode, setColorMode, toggleColorMode };
}
