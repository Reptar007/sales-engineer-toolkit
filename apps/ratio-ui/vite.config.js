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
    // Exclude visual regression tests in CI environments
    exclude: [
      ...(process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
        ? ['**/visual-regression.test.js']
        : []),
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
    ],
  },
});
