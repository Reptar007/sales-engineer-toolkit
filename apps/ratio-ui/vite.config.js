import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
