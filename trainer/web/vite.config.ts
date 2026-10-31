import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served at / on its own domain, or under a path (TRAINER_BASE=/train/) inside the CRM site.
export default defineConfig({
  base: process.env.TRAINER_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: { '/api': { target: 'http://localhost:5020', timeout: 180000 } },
  },
})
