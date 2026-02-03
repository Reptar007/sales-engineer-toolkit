import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Load .env from repo root (single source of truth)
  envDir: resolve(__dirname, '..'),
  server: {
    port: 5173,
    open: true, // Auto-open browser to frontend dev server
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts: ['qa-sales-engineering-d254283855b0.herokuapp.com'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    css: true,
    // Exclude visual regression tests in CI environments and Playwright E2E tests
    exclude: [
      ...(globalThis.process?.env?.CI === 'true' ||
      globalThis.process?.env?.GITHUB_ACTIONS === 'true'
        ? ['**/visual-regression.test.js']
        : []),
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/e2e/**', // Exclude Playwright tests from Vitest
    ],
  },
});
