/**
 * @file The character vault — the SOLE choke point for reading and writing
 * {@link CharacterRecord} records (`NimbleCharacter` or `MonsterSheet`) to
 * OBR scene metadata.
 *
 * Every record lives under its own root-level scene-metadata key,
 * `${CHARACTER_KEY_PREFIX}<id>` (never one shared object under a single
 * key): `OBR.scene.setMetadata` merges at the root-key level, so giving
 * each character its own key means two players editing two different
 * characters at the same time never race each other's write — a shared
 * single-object key would force a read-modify-write where whichever write
 * lands last wins and silently drops the other.
 *
 * Exposes exactly four functions — `saveCharacter`, `loadCharacter`,
 * `listCharacters`, `deleteCharacter` — and nothing else. No other module in
 * this codebase may call `OBR.scene.setMetadata`/`getMetadata` for character
 * data; going through this module is what will let the storage backend
 * change later without touching every call site. `useOBR.ts` still calls
 * `OBR.scene.items.*` directly for the token-side {@link CharacterLink} —
 * that's a different concern (which token points at which character), not
 * vault storage.
 *
 * This file has a hard OBR SDK dependency and is therefore NOT unit tested
 * (this project does not mock the OBR SDK — see CLAUDE.md): it is
 * deliberately kept thin, a one-line wrapper per operation, so the only
 * logic worth testing (migration on read — see `characterMigrations.ts`)
 * already is, elsewhere. Manual multi-client verification is required for
 * this file's actual behavior — see the manual validation section handed
 * over alongside this change.
 */

import OBR from "@owlbear-rodeo/sdk";
import { migrateVaultRecord } from "./characterMigrations";
import type { CharacterRecord } from "../types/character";

/**
 * Root-level scene-metadata key prefix a character is stored under:
 * `${CHARACTER_KEY_PREFIX}<id>`. Not exported — every caller goes through
 * this module's four functions instead of building the key itself.
 */
const CHARACTER_KEY_PREFIX = "com.nimble-obr.nimble/character/";

function vaultKey(id: string): string {
  return `${CHARACTER_KEY_PREFIX}${id}`;
}

/**
 * Writes `character` to the vault under its own `id`, overwriting whatever
 * was there before in full (never a partial/field-level merge — the caller
 * is expected to have already merged onto the latest known state, same
 * discipline `useOBR.ts`'s `updateCharacter` already applied when the
 * character lived in item metadata).
 */
export async function saveCharacter(character: CharacterRecord): Promise<void> {
  await OBR.scene.setMetadata({ [vaultKey(character.id)]: character });
}

/**
 * Reads one character from the vault by id.
 *
 * @returns The character, migrated to {@link CURRENT_SCHEMA_VERSION} and
 * validated (same `migrateCharacter` choke point as the legacy per-token
 * read path — see `characterMigrations.ts`), or `null` if nothing is stored
 * under that id (never stored yet, or already deleted) OR if what's stored
 * fails validation even after migration. The two `null` cases are not
 * distinguished to the caller: both mean "the vault has no usable answer
 * for this id", which is exactly what every current caller
 * (`resolveCharacterRead` in `characterVault.ts`) needs to know before
 * falling back to a token's snapshot. A corrupted vault entry is logged to
 * the console either way, same as a corrupted legacy per-token record
 * always has been.
 *
 * Dispatches on the raw value's own `kind` via {@link migrateVaultRecord} —
 * a vault key holds either a `NimbleCharacter` or a `MonsterSheet`
 * indistinguishably from the key alone, so the migration/validation path
 * that actually matches the stored shape has to be chosen from its content.
 */
export async function loadCharacter(id: string): Promise<CharacterRecord | null> {
  const meta = await OBR.scene.getMetadata();
  const raw = meta[vaultKey(id)];
  if (raw === undefined) return null;

  const result = migrateVaultRecord(raw);
  if (result.status === "ok") return result.character;

  console.error(
    `[Nimble] Vault character "${id}" failed to load: ${
      result.status === "invalid" ? result.reason : `schemaVersion ${result.foundVersion} is newer than this build supports`
    }`,
  );
  return null;
}

/**
 * Reads every character currently in the vault.
 *
 * @remarks Used by the orphaned-monster cleanup pass and (later) the
 * "Recover a lost soul" recovery UI — both need the full list to compare
 * against which characters are still linked to a token; see
 * `findOrphanedCharacters` in `characterVault.ts`. A vault entry that fails
 * validation is skipped (logged, not thrown) rather than aborting the whole
 * listing — one corrupted character must not hide every other legitimate
 * one from cleanup/recovery.
 */
export async function listCharacters(): Promise<CharacterRecord[]> {
  const meta = await OBR.scene.getMetadata();
  const characters: CharacterRecord[] = [];
  for (const key of Object.keys(meta)) {
    if (!key.startsWith(CHARACTER_KEY_PREFIX)) continue;
    const result = migrateVaultRecord(meta[key]);
    if (result.status === "ok") {
      characters.push(result.character);
    } else {
      console.error(
        `[Nimble] Vault entry "${key}" failed to load: ${
          result.status === "invalid" ? result.reason : `schemaVersion ${result.foundVersion} is newer than this build supports`
        }`,
      );
    }
  }
  return characters;
}

/**
 * Removes a character from the vault entirely.
 *
 * @remarks Deletes by setting the key to `undefined` in a `setMetadata`
 * patch, per the OBR SDK's own merge semantics for scene metadata — NOT
 * with the `delete` operator, which only removes it from a local object and
 * would leave the key untouched in the actual scene metadata.
 */
export async function deleteCharacter(id: string): Promise<void> {
  await OBR.scene.setMetadata({ [vaultKey(id)]: undefined });
}
