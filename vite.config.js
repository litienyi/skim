import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist/build/pdf.worker.min.js']
  },
  build: {
    commonjsOptions: {
      include: [/pdfjs-dist/]
    }
  },
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..', 'node_modules']
    }
  }
})
