import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Lets an HTTPS tunnel (cloudflared / ngrok) reach the dev server for phone testing.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    proxy: {
      // changeOrigin: false keeps the browser's Host, so the API can tell same-origin requests apart.
      "/api": { target: "http://localhost:5000", changeOrigin: false },
      "/uploads": { target: "http://localhost:5000", changeOrigin: false },
      "/socket.io": { target: "http://localhost:5000", ws: true, changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          map: ["maplibre-gl"],
          motion: ["framer-motion"],
        },
      },
    },
  },
  test: { environment: "node" },
});
