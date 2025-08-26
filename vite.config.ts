import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Use BASE_PATH env when building in CI (set in the workflow).
// Falls back to "/" for local dev.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/"
});
