# Rebuilding the project from scratch

This is not needed to work on this repository: cloning it and running `npm install && npm run dev` is enough (see the main [README](../README.md)). This document only exists as a record of how the project was originally scaffolded (Vite + React + TypeScript + Tailwind v4, wired for an Owlbear Rodeo extension), in case that setup ever needs to be reproduced for a new project.

## 1. Create the Vite project

```bash
npm create vite@latest nimble-obr -- --template react-ts
cd nimble-obr
```

## 2. Install the OBR SDK

```bash
npm install @owlbear-rodeo/sdk
```

## 3. Install Tailwind CSS v4

```bash
npm install tailwindcss @tailwindcss/vite
```

Tailwind v4 is configured entirely through CSS (`@tailwindcss/vite` plugin, directives in `src/index.css`); there is no `tailwind.config.js` file to create.

## 4. Install the SSL plugin (required by OBR for local dev)

```bash
npm install -D @vitejs/plugin-basic-ssl
```

## 5. Configure Vite for an OBR extension

In `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Only in dev: OBR loads extensions in an iframe requiring HTTPS, and
    // this plugin generates a self-signed cert. It must never load during
    // a production build.
    ...(command === 'serve' ? [basicSsl()] : []),
  ],
  server: {
    https: {},
    port: 5173,
    cors: true,
  },
}))
```

> **Why HTTPS?** OBR loads extensions in an iframe and requires an HTTPS origin even in local dev. Vite generates a self-signed certificate; accept the browser's security exception the first time you visit the dev URL directly.

## 6. Wire up the Tailwind directives

In `src/index.css`, see this project's actual file for the full content ("Nimble" design tokens, iframe reset, thin scrollbar, etc.).

## 7. Check `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```
