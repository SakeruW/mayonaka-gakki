import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative asset paths, so dist/ also works when published as a claude.ai artifact
  base: "./",
  plugins: [react()],
  build: { target: "es2022" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
