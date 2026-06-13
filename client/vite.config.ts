import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    cors: {
      origin: '*',
    },
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5010',
      '/uploads': 'http://localhost:5010',
    },
  },
})
