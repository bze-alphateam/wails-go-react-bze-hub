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
