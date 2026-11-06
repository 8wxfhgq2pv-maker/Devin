import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001";

// Trust only this proxy's socket peer, never incoming forwarded headers.
const apiProxy: ProxyOptions = {
  target: backendUrl,
  changeOrigin: false,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => {
      proxyReq.removeHeader("forwarded");
      proxyReq.removeHeader("x-forwarded-host");
      proxyReq.removeHeader("x-forwarded-for");
      proxyReq.removeHeader("x-webui-proxy-secret");
      const secret = process.env.WEBUI_PROXY_SECRET?.trim();
      if (secret && req.socket.remoteAddress) {
        proxyReq.setHeader("x-forwarded-for", req.socket.remoteAddress);
        proxyReq.setHeader("x-webui-proxy-secret", secret);
      }
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxy,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": apiProxy,
    },
  },
});
