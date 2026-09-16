import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: "0.0.0.0",
        proxy: {
            "/api": {
                target: process.env.VITE_DEV_API_PROXY_TARGET || "http://localhost:3000",
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ""); }
            },
            "^/jaeger(?:/|$)": {
                target: process.env.VITE_DEV_JAEGER_PROXY_TARGET || "http://localhost:16686",
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/jaeger(?=\/|$)/, "") || "/"; }
            }
        }
    }
});
