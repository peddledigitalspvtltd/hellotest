import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "hellotest-admin-root",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const url = new URL(request.url || "/", "http://admin.local");
          if (url.pathname === "/" || url.pathname === "/admin/") request.url = `/admin.html${url.search}`;
          if (url.pathname === "/admin/runtime-config.js") request.url = `/runtime-config.js${url.search}`;
          next();
        });
      }
    }
  ],
  server: {
    port: 5174,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET || "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  },
  build: {
    outDir: "dist-admin",
    emptyOutDir: true,
    rollupOptions: { input: "admin.html" }
  }
});
