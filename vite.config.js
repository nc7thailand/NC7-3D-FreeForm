import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    open: true,
    allowedHosts: [
      'nc7s-mac-mini.tail36564e.ts.net',
      '100.64.95.27',
      '.tail36564e.ts.net',
    ],
  },
  build: {
    outDir: 'dist'
  }
})
