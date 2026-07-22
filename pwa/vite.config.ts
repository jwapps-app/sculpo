import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, APP_TAGLINE } from "./src/constants/branding.ts";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8020",
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_TAGLINE,
        display: "standalone",
        background_color: "#232936",
        theme_color: "#232936",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
