/**
 * @file Vite configuration for the Nimble OBR extension.
 *
 * Uses the function form of `defineConfig` so we know whether we're
 * running `vite dev` (mode === "development", or more precisely the
 * `command` is "serve") or `vite build` (command === "build") *before*
 * deciding which plugins to load.
 *
 * `@vitejs/plugin-basic-ssl` generates a self-signed certificate, which
 * is required by OBR for local development (it loads extensions in an
 * iframe and requires an HTTPS origin even on localhost) but must never
 * ship in a production build — a self-signed cert would be rejected by
 * browsers and serves no purpose once deployed behind real HTTPS hosting
 * (Vercel/Netlify/GitHub Pages all provide that for you).
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Only load the self-signed SSL plugin during local dev.
      ...(isDev ? [basicSsl()] : []),
    ],
    server: {
      // HTTPS is needed by OBR for local dev
      https: isDev ? {} : undefined,
      port: 5173,
      cors: true,
    },
    // OBR manifest must be served from /public
    publicDir: 'public',
  }
})