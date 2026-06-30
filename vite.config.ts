import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
  build: {
    // 生产构建优化
    minify: mode === 'production' ? 'esbuild' : false,
    sourcemap: mode !== 'production', // 仅开发模式生成 sourcemap
    rollupOptions: {
      output: {
        // 移除 console 和 debugger
        manualChunks: undefined,
      },
    },
  },
  esbuild: {
    // 生产模式下移除 console 和 debugger
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/**/*.d.ts", "src/test/**"],
    },
  },
} as UserConfig));
