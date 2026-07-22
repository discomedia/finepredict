import { defineConfig } from "vitest/config";

/** Vitest configuration for DOM-facing extension unit tests. */
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
