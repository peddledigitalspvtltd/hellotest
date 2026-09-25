import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { featureSourceConfig } from "./vite.feature-sources";

declare const process: {
  env: Record<string, string | undefined>;
};

export default defineConfig({
  resolve: featureSourceConfig.resolve,
  plugins: [react()],
  server: {
    fs: featureSourceConfig.fs,
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "^/api(?:/|$)": {
        target: process.env.VITE_DEV_API_PROXY_TARGET || "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      },
      "^/jaeger(?:/|$)": {
        target: process.env.VITE_DEV_JAEGER_PROXY_TARGET || "http://localhost:16686",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/jaeger(?=\/|$)/, "") || "/"
      }
    }
  }
});
