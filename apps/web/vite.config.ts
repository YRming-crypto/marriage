import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4183,
    allowedHosts: [".trycloudflare.com", ".lhr.life"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4184",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4183,
  },
});
