import { defineConfig } from "vitest/config";

// Pure-logic unit tests (staking helpers, scoring, stake-health). No DOM needed,
// so we run in the Node environment. Component/DOM tests can switch to jsdom later.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
