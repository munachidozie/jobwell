import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Separate from vite.config.ts so tests scan the whole src tree, not just the
// renderer root. The shared match-scoring logic lives in src/shared.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    root: __dirname,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    // node:sqlite is a Node builtin Vite's resolver doesn't recognize. Force
    // the test runner to import the source directly (not through Vite's
    // transform pipeline) so the builtin resolves natively.
    server: {
      deps: {
        external: [/node:sqlite/],
      },
    },
    deps: {
      optimizer: {
        ssr: {
          exclude: ["node:sqlite"],
        },
      },
    },
  },
});
