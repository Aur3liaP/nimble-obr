---
name: verify
description: Run this repo's verification bar (type-check + lint) and remind about manual OBR testing for permission/sync-sensitive changes. Use before considering a change to nimble-obr done, or when the user asks to verify/check the current changes.
---

This project has no automated test suite (no vitest/jest/playwright configured), so "done" means:

1. Run `npm run type-check` (`tsc --noEmit`). Fix any type errors before proceeding.
2. Run `npm run lint` (`eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`). Fix any lint errors/warnings — `--max-warnings 0` means warnings fail the run too.
3. Look at what changed. If it touches any of the following, tell the user it needs **manual multiplayer verification in Owlbear Rodeo** (GM account + at least one player account) rather than claiming it's fully verified:
   - Permission logic (`useOBR.ts`, `permissions.canEdit`/`isGM`/`isOwner`, anything gating `updateCharacter`)
   - OBR sync (`OBR.scene.items.updateItems`, `OBR.scene.setMetadata`, `onMetadataChange` listeners)
   - The roll log's one-directional update flow (visible rolls must only update local state via the `onMetadataChange` listener, never directly from the push function)
   - Sheet claim/take-over flow

Report results concisely: type-check status, lint status, and — only if applicable — which specific behavior needs manual multiplayer testing and why.
