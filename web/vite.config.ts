import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    // Same-origin in dev so EventSource and fetch need no CORS dance.
    proxy: { "/v1": "http://localhost:3177" },
  },
});
