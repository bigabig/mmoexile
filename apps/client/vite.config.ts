import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // account-api (login, characters, play tickets)
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // directory: realms and their regions (region selector)
      "/directory": {
        target: "http://localhost:3004",
        rewrite: (path) => path.replace(/^\/directory/, ""),
      },
    },
  },
});
