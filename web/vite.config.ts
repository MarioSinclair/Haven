import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The API server (../server) in development; in production it serves this app itself.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    rollupOptions: {
      input: { main: 'index.html', judges: 'judges/index.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
