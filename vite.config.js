import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The front end is built into `public/`, which the server serves as static
 * files when it is there and skips when it is not — so a checkout that has
 * never run the build still starts and still answers the API.
 */
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` talks to the real server for anything under /api.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
