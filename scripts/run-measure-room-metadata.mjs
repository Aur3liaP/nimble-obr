// Bootstrap for `scripts/measure-room-metadata.ts`.
//
// That script imports from `src/` using this project's normal extensionless
// relative imports (e.g. `from "../types/character"`), which Node's native
// ESM resolver cannot follow — TypeScript/bundler-style module resolution is
// a Vite/tsc concept, not a Node one. Rather than run the script through
// Node directly, this loads it through Vite's own dev-server module graph
// in SSR mode (the same "vite-node" pattern the `vite-node` package
// implements), so it resolves imports exactly like `vite build`/`vitest`
// already do for the rest of this codebase, using only the `vite` dependency
// already in `devDependencies` — no new dependency added for this one script.
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  await server.ssrLoadModule("/scripts/measure-room-metadata.ts");
} finally {
  await server.close();
}
