/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
/* eslint-disable @typescript-eslint/no-explicit-any */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
  build: {
    // Pull the heavy editor + workers into their own chunks so the initial
    // app load isn't blocked on ~2 MB of Monaco.  The dynamic
    // `import('./FormulaEditor')` in StepToolbar is what actually defers it
    // at runtime; this just keeps the chunk graph tidy.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/monaco-editor')) return 'monaco';
          if (id.includes('node_modules/@monaco-editor')) return 'monaco';
          if (id.includes('node_modules/react-arborist')) return 'arborist';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
} as any)
/* eslint-enable @typescript-eslint/no-explicit-any */
