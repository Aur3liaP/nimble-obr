/**
 * @file Vitest configuration for the Nimble OBR extension.
 *
 * Kept separate from `vite.config.ts` rather than merged into it: the app
 * config conditionally loads `@vitejs/plugin-basic-ssl` and sets up an HTTPS
 * dev server for the OBR iframe requirement, none of which is relevant (or
 * safe to spin up) for a Node-based unit test run.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
