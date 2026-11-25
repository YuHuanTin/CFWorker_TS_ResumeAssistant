import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 两种用法：
 *   1) `vite build`（由 wrangler.jsonc 的 build.command 调用）
 *      产物进 public/，交给 Workers Static Assets。
 *   2) `vite`（npm run dev:ui）
 *      只跑前端，带 HMR；/api 请求代理到 8787 上运行的 wrangler dev。
 */
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // AI 接口跑在 Worker 里，开发时转发过去，避免 CORS
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
