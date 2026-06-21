import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^zustand(.*)/, replacement: path.resolve(__dirname, 'node_modules/zustand$1') },
      { find: /^react-dom(.*)/, replacement: path.resolve(__dirname, 'node_modules/react-dom$1') },
      { find: /^react(.*)/, replacement: path.resolve(__dirname, 'node_modules/react$1') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['webview-src/**/*.{ts,tsx}', 'src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
