import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxies /api + /ws to the running daemon (5055, the product port). In
// production the daemon serves the built dist itself, so these paths are
// same-origin and no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:5055', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:5055', ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})
