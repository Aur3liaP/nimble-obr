# 🎲 Nimble Character Sheet — OBR Extension

Extension Owlbear Rodeo pour jouer au TTRPG **Nimble**. Fiche de personnage interactive en panneau latéral, synchronisée en temps réel pour tous les joueurs à la table.

---

## Stack technique

- **React 19** + **TypeScript**
- **Vite** (dev server + build)
- **Tailwind CSS v4**
- **@owlbear-rodeo/sdk** (v3.1.0)

---

## 🤖 AI-Augmented Engineering

Ce projet a été développé avec une approche **AI-Augmented Engineering** (développement assisté par LLM), et sert aussi de terrain d'entraînement personnel à l'utilisation avancée de l'IA en contexte professionnel.

### Ce qui a été fait "à la main"

- Architecture générale du projet (structure des dossiers, séparation types/hooks/composants/utils).
- Définition du schéma de données (`NimbleCharacter` et types associés).
- Maquette de design de base (layout bento, palette, placement des éléments).
- Toutes les décisions de game design et de règles métier (calculs de formules, permissions, comportement des onglets).

### Ce qui a été fait avec l'aide de l'IA (Claude)

- Génération et itération du code des composants React/Tailwind à partir de specs détaillées.
- Refactoring progressif (extraction de composants communs : `BentoSection`, `FormField`, `RollButton`, etc.) pour réduire la duplication entre les onglets.
- Documentation du code (JSDoc) sur l'ensemble des fichiers.
- Debug de comportements complexes liés au SDK OBR (synchronisation multi-clients, permissions `canEdit`, gestion du roll log partagé).

### Méthode : Context Injection & RAG manuel

Le point clé de cette approche a été de **structurer une base de connaissances dédiée** pour l'IA, afin de garantir la cohérence des réponses sur la durée du projet :

- **Contexte technique persistant** : stack, contraintes du SDK OBR (pas de backend, sauvegarde via metadata, namespace dédié `com.nimble-obr.nimble/character_sheet`), conventions de code du projet.
- **Contexte game design** : règles officielles du jeu Nimble (extraites du PDF de référence) injectées en contexte pour la génération du JSON des sorts/objets/équipements, afin que les données générées respectent fidèlement les règles publiées.
- **Mémoire de session** : au fil des itérations (V1 → V2 → V3), le contexte d'avancement (bugs corrigés, fichiers clés, décisions prises) a été reporté entre les sessions de travail pour éviter les régressions et garder une cohérence d'architecture.

Cette méthode s'apparente à du **RAG (Retrieval-Augmented Generation) manuel** : plutôt que de laisser le modèle "deviner" le contexte ou règle quoi que ce soit depuis ses connaissances génériques sur OBR ou Nimble, les informations de référence exactes (documentation SDK, règles du jeu) sont injectées explicitement à chaque étape pertinente.

### Limites assumées

L'IA n'a pas pris de décision d'architecture ou de design sans validation. Chaque étape (nouveau composant, refactor, correction de bug) a été testée manuellement en environnement OBR multi-joueurs (un compte MJ + plusieurs comptes joueurs simultanés) avant d'être validée, en particulier pour tout ce qui touche aux **permissions** (`canEdit`, `ownerId`) qui sont critiques pour la sécurité fonctionnelle de l'outil.

---

## Prérequis

- **Node.js ≥ 18** (LTS recommandé)
- **npm ≥ 9** (ou pnpm / yarn si tu préfères)
- Un compte [Owlbear Rodeo](https://www.owlbear.rodeo/) pour tester l'extension

---

## Installation from scratch (projet Vite + React + TS + Tailwind)

### 1. Créer le projet Vite

```bash
npm create vite@latest nimble-obr -- --template react-ts
cd nimble-obr
```

### 2. Installer les dépendances principales

```bash
npm install @owlbear-rodeo/sdk
```

### 3. Installer Tailwind CSS v4

```bash
npm install tailwindcss @tailwindcss/vite
```

### 4. Installer le plugin SSL (requis par OBR en dev local)

```bash
npm install -D @vitejs/plugin-basic-ssl
```

### 5. Configurer Vite pour l'extension OBR

Dans **`vite.config.ts`** :

```ts
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
```

> **Pourquoi HTTPS ?** OBR charge les extensions dans une iframe et impose une origine HTTPS même en local. Vite génère un certificat auto-signé — accepte l'exception de sécurité dans ton navigateur la première fois.

### 6. Injecter les directives Tailwind dans le CSS global

Dans **`src/index.css`**, voir le contenu actuel du fichier (design tokens "Nimble", reset pour iframe OBR, scrollbar fine, etc.)

### 7. Vérifier `src/main.tsx`

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

---

## Structure du projet

```
nimble-obr/
├── public/
│   ├── manifest.json          ← manifest de l'extension OBR
│   └── icon.svg                ← icône de l'extension
├── src/
│   ├── types/
│   │   └── character.ts        ← types du domaine (NimbleCharacter, etc.)
│   ├── utils/
│   │   └── formulaParser.ts    ← parseur de formules + moteur de dés
│   ├── data/
│   │   ├── spells.ts           ← sorts officiels (BASE_SPELLS)
│   │   └── equipment.ts        ← équipement officiel (BASIC_EQUIPMENTS)
│   ├── hooks/
│   │   └── useOBR.ts           ← intégration SDK OBR (état, permissions, rolls)
│   ├── components/
│   │   ├── ui/
│   │   │   ├── common/         ← composants réutilisables (BentoSection, FormField, RollButton…)
│   │   │   ├── StatBox.tsx
│   │   │   ├── DiceRollModal.tsx
│   │   │   ├── DicePanel.tsx
│   │   │   ├── RollLog.tsx
│   │   │   └── LanguageSelector.tsx
│   │   └── tabs/
│   │       ├── SummaryTab.tsx
│   │       ├── CombatTab.tsx
│   │       ├── SpellsTab.tsx
│   │       └── InventoryTab.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── tailwind.config.js
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Lancer le serveur de développement

```bash
npm run dev
```

Le terminal affiche une URL du type `https://localhost:5173`. C'est celle-là qu'on va enregistrer dans OBR.

---

## Enregistrer l'extension dans Owlbear Rodeo

1. Ouvre [owlbear.rodeo](https://www.owlbear.rodeo/) et crée une partie (ou ouvre une existante).
2. Dans le menu latéral gauche, clique sur l'icône **Extensions** (puzzle piece).
3. Clique sur **"Add Extension"**.
4. Entre l'URL du manifest : `https://localhost:5173/manifest.json`
5. Accepte le certificat HTTPS si ton navigateur te l'affiche (visite `https://localhost:5173` directement une fois).
6. L'extension apparaît dans le menu — clique dessus pour ouvrir le panneau.

---

## Build de production

```bash
npm run build
```

Les fichiers statiques sont dans `dist/`. Tu peux les héberger sur :
- **Vercel** (`vercel --prod`)
- **Netlify** (drag & drop du dossier `dist/`)
- **GitHub Pages** (avec `vite.config.ts` → `base: '/nimble-obr/'`)

> Le manifest.json devra pointer vers ton URL de production, pas localhost.

---

## Architecture des données

La fiche est stockée dans les **metadata** du token OBR sous la clé :

```
com.nimble-obr.nimble/character_sheet
```

Ce namespace unique évite les conflits avec d'autres extensions. Toute modification appelle `OBR.scene.items.updateItems()`, ce qui la propage instantanément à tous les clients connectés.

L'historique des lancés de dés (visibles par toute la table) est stocké séparément dans les **metadata de la scène**, sous une clé dérivée du même namespace, et plafonné à 20 entrées.

### Qui peut modifier quoi ?

| Rôle | Peut modifier |
|------|--------------|
| Joueur — propriétaire du token (`ownerId`) | Sa propre fiche |
| GM | Toutes les fiches, indépendamment de `ownerId` |
| Joueur — autre token | Lecture seule (boutons d'édition masqués, pas seulement désactivés) |

Cette permission est centralisée dans un objet `permissions` (`{ canEdit, isGM, isOwner, isUnclaimed }`), calculé une seule fois dans `useOBR` et propagé explicitement en props à chaque composant interactif — il ne se propage jamais "automatiquement" via le contexte React, ce qui nécessite une vérification systématique de chaque nouveau composant ajouté.

**Garde côté écriture** : `updateCharacter` (dans `useOBR`) revérifie `canEdit` avant chaque appel à `OBR.scene.items.updateItems`, et abandonne silencieusement (avec un `console.warn`) si l'appelant n'a pas les droits. Ce n'est pas une vraie barrière de sécurité — OBR n'a pas d'ACL serveur sur les metadata, donc un joueur déterminé pourrait toujours écrire via les devtools — mais ça évite les écritures accidentelles déclenchées par un état UI obsolète (ex : un bouton qui aurait dû être masqué/désactivé mais ne l'était pas encore lors d'un re-render).

**Lancer un dé reste possible en lecture seule** : `handleRoll` n'est volontairement pas soumis à `canEdit` — un joueur qui regarde la fiche d'un autre peut quand même lancer un dé avec ses stats. Seule la persistance de modifications sur la fiche elle-même passe par la garde de `updateCharacter`.

**"Claim" / "Take over"** : `claimToken` n'est pas non plus gardé par `canEdit`, puisqu'il est justement le point d'entrée qui accorde les droits d'édition. Actuellement, n'importe quel joueur peut "Take over" la fiche d'un autre joueur déjà réclamée (choix délibéré pour une table de confiance entre amis) — si ce comportement doit être restreint au GM, la garde doit être ajoutée côté bouton dans `App.tsx`/`CharacterHeader.tsx`.


## Formules supportées

Le parser de formules (`src/utils/formulaParser.ts`) supporte :

| Syntaxe | Exemple | Résultat |
|---------|---------|----------|
| Dés | `1d8`, `2d6` | tirage aléatoire |
| Stats | `STR`, `DEX`, `INT`, `WIL` | valeur du personnage |
| Stat clé / défaut | `KEY`, `FLAW` | valeur de la stat marquée clé/défaut |
| Compétences | `MIGHT`, `STEALTH`, `ARCANA`… | valeur de la compétence |
| Niveau | `LEVEL` | niveau actuel |
| Maths | `+`, `-`, `*`, `/` | opérations de base |
| Arrondi | `floor(LEVEL/5)`, `ceil(...)` | arrondi inférieur/supérieur |
| Min/Max | `min(a, b)`, `max(a, b)` | valeur min/max |
| Dés dynamiques | `incrementdice(1, level)d12`, `stepdice(level, 4, 8, 10, 12)` | dés évolutifs avec le niveau |
| Combiné | `1d10 + STR + floor(LEVEL/5) * 5` | formule avancée |

> `eval()` n'est **jamais** utilisé — le parser est un descent récursif maison, pour éviter tout risque d'exécution de code arbitraire via une formule tapée par un joueur ou le MJ.

---

## Prochaines étapes (roadmap)

- [ ] Onglet traduction FR/EN
- [ ] Sélection de classe avec pré-remplissage des stats de départ
- [ ] Panneau d'extension repositionnable / détachable (recherche en cours sur le SDK OBR)
- [ ] Thème clair "parchemin" optionnel
- [ ] Import/export JSON de la fiche
- [ ] Raccourcis clavier pour les lancers fréquents

---

## Ressources

- [OBR SDK docs](https://extensions.owlbear.rodeo/docs)
- [Vite docs](https://vitejs.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Nimble TTRPG](https://nimble-ttrpg.com)