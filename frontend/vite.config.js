import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        // Don't rewrite the path - keep /api prefix for backend
      },
    },
  },
  preview: {
    allowedHosts: ['qa-sales-engineering-d254283855b0.herokuapp.com'],
  },
});
