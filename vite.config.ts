import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // HTTPS requis par OBR pour le développement local
    // https: true,
    port: 5173,
    cors: true,
  },
  // Le manifest OBR doit être servi depuis /public
  publicDir: 'public',
})