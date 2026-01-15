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
} as any)
/* eslint-enable @typescript-eslint/no-explicit-any */
