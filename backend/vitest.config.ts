import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // better-sqlite3 is a native module; forks avoids worker-thread binding issues
    pool: "forks",
    include: ["test/**/*.test.ts"],
  },
});
