import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Project Blackout",
        short_name: "Blackout",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
