import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => ({
  // relative asset paths, so dist/ also works when published as a claude.ai artifact
  base: "./",
  // `npm run dev:lan` serves HTTPS on the network: phones need a secure page for the tape's AudioWorklet and the mic
  plugins: [react(), ...(mode === "lan" ? [basicSsl()] : [])],
  build: { target: "es2022" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
}));
