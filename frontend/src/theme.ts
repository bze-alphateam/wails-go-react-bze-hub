import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    body: {
      colorPalette: "teal",
    },
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
        heading: { value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
      },
    },
    semanticTokens: {
      radii: {
        l1: { value: "0.375rem" },
        l2: { value: "0.5rem" },
        l3: { value: "0.75rem" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

/** The app's top-level sections (see BZE Hub UX & navigation). */
export type SectionId =
  | "dashboard"
  | "portfolio"
  | "trade"
  | "earn"
  | "burner"
  | "create";

/**
 * Per-section accent colors, expressed as Chakra `colorPalette` names so they
 * resolve correctly in both light and dark themes. Applied to the active nav
 * item and the section accent strip / headers.
 *
 * Dashboard and Portfolio use the neutral brand accent (teal); the feature
 * sections each get a distinct hue.
 */
export const sectionAccent: Record<SectionId, string> = {
  dashboard: "teal",
  portfolio: "teal",
  trade: "blue",
  earn: "purple",
  burner: "orange",
  create: "yellow",
};
