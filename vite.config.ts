import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    // HTTPS requis par OBR pour le développement local
    https: {},
    port: 5173,
    cors: true,
  },
  // Le manifest OBR doit être servi depuis /public
  publicDir: 'public',
})