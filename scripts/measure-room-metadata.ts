/**
 * @file Reproducible offline measurement script for the room-metadata
 * migration feasibility study.
 *
 * Builds the worst-case-realistic character fixture (`worstCaseCharacterFixture.ts`)
 * from the real `NimbleCharacter` type and the real game catalogs, measures
 * its weight broken down by field group, extrapolates across several
 * character counts against the self-imposed 8KB namespace budget, and
 * measures the byte gain of every slimming strategy under consideration —
 * both individually and combined.
 *
 * Run via `npm run measure:room-metadata` (see `scripts/run-measure-room-metadata.mjs`
 * for why a plain `node script.ts` can't run this directly: this project's
 * own source files use extensionless relative imports, which Node's native
 * ESM resolver can't follow — the bootstrap script uses Vite's own resolver
 * instead, in SSR mode, so this file can import from `src/` exactly like
 * the rest of the app does).
 *
 * Console output is in French — this script IS the "rapport reproductible"
 * deliverable the user reads directly, not application UI copy.
 */

import { ROOM_METADATA_NAMESPACE_BUDGET_BYTES, ROOM_METADATA_TOTAL_BUDGET_BYTES } from "../src/utils/metadataBudget";
import { METADATA_KEY } from "../src/types/character";
import { buildWorstCaseCharacter } from "../src/utils/worstCaseCharacterFixture";
import { byteSize } from "../src/utils/byteSize";
import {
  buildKeyShorteningMap,
  compareSkillsStorage,
  extrapolateRoomMetadataCost,
  gzipBase64Size,
  measureCharacterWeight,
  perEntryKeyOverheadBytes,
  shortenKeysDeep,
  withCatalogDescriptionsStripped,
  withoutTransientInitiativeResult,
} from "../src/utils/metadataSizing";

const CHARACTER_COUNTS = [1, 4, 6, 8];
const EXAMPLE_ROOM_KEY = `${METADATA_KEY}/characters/${"a".repeat(36)}`; // token IDs are UUIDs, 36 chars

function ko(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} Ko`;
}

function pct(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function printSection(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

function main() {
  const character = buildWorstCaseCharacter();

  printSection("1. Profil pire cas réaliste");
  console.log(`Niveau : ${character.level}`);
  console.log(`Emplacements d'inventaire : ${character.inventorySlots} (10 + STR ${character.stats.str}), remplis à 100%`);
  const spellCount = character.actions.filter((a) => a.type === "spell").length;
  const nonSpellCount = character.actions.filter((a) => a.type !== "spell").length;
  console.log(`Actions : ${character.actions.length} (${spellCount} sorts, ${nonSpellCount} actions non-sorts)`);
  console.log(`Objets d'inventaire : ${character.inventory.length}`);
  const customActions = character.actions.filter((a) => a.isCustom).length;
  const customItems = character.inventory.filter((i) => i.isCustom).length;
  console.log(`Entrées custom (MJ) : ${customActions} action(s), ${customItems} objet(s)`);

  printSection("2. Ventilation par groupe de champs");
  const weight = measureCharacterWeight(character);
  for (const group of weight.groups) {
    console.log(`  ${group.group.padEnd(18)} ${String(group.bytes).padStart(6)} o  (${pct(group.bytes, weight.totalBytes)})`);
  }
  console.log(`  ${"—".repeat(40)}`);
  console.log(`  ${"TOTAL (1 fiche)".padEnd(18)} ${String(weight.totalBytes).padStart(6)} o  (${ko(weight.totalBytes)})`);
  console.log(`  (somme des groupes : ${weight.groupedBytes} o — écart de ${weight.groupedBytes - weight.totalBytes} o dû à l'enveloppe JSON de chaque groupe mesuré isolément)`);

  printSection("3. Coût par nombre de fiches (référence, sans allègement)");
  const overhead = perEntryKeyOverheadBytes(EXAMPLE_ROOM_KEY);
  console.log(`Overhead par entrée (clé "${EXAMPLE_ROOM_KEY.slice(0, 40)}...") : ${overhead} o`);
  const baseline = extrapolateRoomMetadataCost(weight.totalBytes, CHARACTER_COUNTS, ROOM_METADATA_NAMESPACE_BUDGET_BYTES, overhead);
  for (const row of baseline) {
    console.log(
      `  ${row.characterCount} fiche(s) : ${ko(row.totalBytes)} ${row.overBudget ? "❌ DÉPASSE le budget 8 Ko" : "✅ dans le budget"}`,
    );
  }

  printSection("4a. Stratégie A — descriptions catalogue non stockées (sourceKey, gère la divergence)");
  const afterA = withCatalogDescriptionsStripped(character);
  const bytesA = byteSize(afterA);
  console.log(`Poids après (1 fiche) : ${bytesA} o (${ko(bytesA)})`);
  console.log(`Gain : ${weight.totalBytes - bytesA} o (${pct(weight.totalBytes - bytesA, weight.totalBytes)})`);

  printSection("4b. Stratégie B — ne plus stocker les valeurs dérivées");
  const afterInitiative = withoutTransientInitiativeResult(character);
  const bytesInitiative = byteSize(afterInitiative);
  const initiativeDelta = weight.totalBytes - bytesInitiative;
  console.log(
    `B1. combat.initiativeResult mis à null (valeur transitoire) : ${initiativeDelta >= 0 ? `gain de ${initiativeDelta} o` : `COÛTE ${-initiativeDelta} o de plus ("null" = 4 caractères, plus long qu'un petit total à 2 chiffres)`}`,
  );
  const skillsComparison = compareSkillsStorage(character);
  console.log(
    `B2. skills en totaux (${skillsComparison.totalsBytes} o) vs. skills en points investis (${skillsComparison.investedPointsBytes} o) : delta ${skillsComparison.deltaBytes} o`,
  );
  console.log(
    "    -> Le modèle actuel ne stocke déjà qu'UN SEUL nombre par compétence (le total), il n'y a pas de second champ redondant à supprimer.",
  );

  printSection("4c. Stratégie C — clés JSON raccourcies");
  const keyMap = buildKeyShorteningMap();
  const afterC = shortenKeysDeep(character, keyMap);
  const bytesC = byteSize(afterC);
  console.log(`Poids après (1 fiche) : ${bytesC} o (${ko(bytesC)})`);
  console.log(`Gain : ${weight.totalBytes - bytesC} o (${pct(weight.totalBytes - bytesC, weight.totalBytes)})`);

  printSection("4d. Stratégie D — gzip + base64");
  const gzipResult = gzipBase64Size(character);
  console.log(`JSON brut       : ${gzipResult.jsonBytes} o`);
  console.log(`Gzip (binaire)  : ${gzipResult.gzipBytes} o (${pct(gzipResult.gzipBytes, gzipResult.jsonBytes)} du JSON brut)`);
  console.log(`+ base64 (+33%) : ${gzipResult.base64Bytes} o (${ko(gzipResult.base64Bytes)})`);
  console.log(`Gain net vs. JSON brut : ${gzipResult.jsonBytes - gzipResult.base64Bytes} o (${pct(gzipResult.jsonBytes - gzipResult.base64Bytes, gzipResult.jsonBytes)})`);

  printSection("5. Stratégies combinées (A + C, sans D)");
  const afterAC = shortenKeysDeep(withCatalogDescriptionsStripped(character), keyMap);
  const bytesAC = byteSize(afterAC);
  console.log(`Poids après (1 fiche) : ${bytesAC} o (${ko(bytesAC)})`);
  console.log(`Gain cumulé : ${weight.totalBytes - bytesAC} o (${pct(weight.totalBytes - bytesAC, weight.totalBytes)})`);
  const extrapolatedAC = extrapolateRoomMetadataCost(bytesAC, CHARACTER_COUNTS, ROOM_METADATA_NAMESPACE_BUDGET_BYTES, overhead);
  for (const row of extrapolatedAC) {
    console.log(
      `  ${row.characterCount} fiche(s) : ${ko(row.totalBytes)} ${row.overBudget ? "❌ DÉPASSE le budget 8 Ko" : "✅ dans le budget"}`,
    );
  }

  printSection("6. Stratégies combinées (A + C + D)");
  const gzipAC = gzipBase64Size(afterAC);
  console.log(`Poids après (1 fiche, compressé+base64) : ${gzipAC.base64Bytes} o (${ko(gzipAC.base64Bytes)})`);
  console.log(`Gain cumulé : ${weight.totalBytes - gzipAC.base64Bytes} o (${pct(weight.totalBytes - gzipAC.base64Bytes, weight.totalBytes)})`);
  const extrapolatedACD = extrapolateRoomMetadataCost(
    gzipAC.base64Bytes,
    CHARACTER_COUNTS,
    ROOM_METADATA_NAMESPACE_BUDGET_BYTES,
    overhead,
  );
  for (const row of extrapolatedACD) {
    console.log(
      `  ${row.characterCount} fiche(s) : ${ko(row.totalBytes)} ${row.overBudget ? "❌ DÉPASSE le budget 8 Ko" : "✅ dans le budget"}`,
    );
  }

  let maxFittingCount = 0;
  for (let n = 1; n <= 8; n++) {
    const row = extrapolateRoomMetadataCost(gzipAC.base64Bytes, [n], ROOM_METADATA_NAMESPACE_BUDGET_BYTES, overhead)[0];
    if (!row.overBudget) maxFittingCount = n;
    else break;
  }
  console.log(`Nombre maximum de fiches (pire cas) tenant sous 8 Ko, même avec A+C+D combinées : ${maxFittingCount}`);

  printSection("6bis. Regroupement en un seul blob compressé (borne haute du gain de compression)");
  console.log(
    "Hypothèse alternative : au lieu d'une clé par fiche (compressée indépendamment), toutes les fiches",
  );
  console.log(
    "de la room sont sérialisées ensemble puis compressées UNE SEULE FOIS. Mesuré ici avec des copies",
  );
  console.log(
    "IDENTIQUES du personnage de référence (A+C appliqués) — c'est donc une BORNE HAUTE du gain réel :",
  );
  console.log("des fiches distinctes partagent moins de texte répété que des copies identiques.");
  for (const n of [4, 6, 8]) {
    const combined = Array.from({ length: n }, () => afterAC);
    const combinedGzip = gzipBase64Size(combined);
    const perEntryIndependent = n * gzipAC.base64Bytes;
    console.log(
      `  ${n} fiches : blob unique = ${ko(combinedGzip.base64Bytes)} vs. ${n}x compression indépendante = ${ko(perEntryIndependent)} (gain supplémentaire ${pct(perEntryIndependent - combinedGzip.base64Bytes, perEntryIndependent)})`,
    );
  }
  console.log(
    "Coût non mesuré en octets : un blob unique signifie qu'UNE seule écriture couvre TOUTES les fiches — deux",
  );
  console.log(
    "joueurs qui modifient leur fiche en même temps risquent un écrasement (last-write-wins sur setMetadata),",
  );
  console.log("contre un risque limité à sa propre fiche avec une clé par personnage.");

  printSection("Constantes de référence");
  console.log(`Budget total room metadata (OBR, partagé) : ${ko(ROOM_METADATA_TOTAL_BUDGET_BYTES)}`);
  console.log(`Budget namespace (auto-imposé, cette extension) : ${ko(ROOM_METADATA_NAMESPACE_BUDGET_BYTES)}`);

  console.log("\nMesure terminée.\n");
}

main();
