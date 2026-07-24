import { defineConfig } from "vitest/config";

// Unit tests (pure-logic helpers, `*.test.ts`) and component/DOM tests
// (`*.test.tsx`) both run under jsdom — harmless for the node-only unit tests
// and required for the React Testing Library component tests.
//
// We deliberately do NOT use @vitejs/plugin-react here: its Fast Refresh
// preamble isn't injected in the Vitest runtime and throws "can't detect
// preamble". esbuild's automatic JSX transform is all the tests need.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
