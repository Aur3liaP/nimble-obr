# 🎲 Nimble Character Sheet — OBR Extension

Extension Owlbear Rodeo pour jouer au TTRPG **Nimble**. Fiche de personnage interactive en panneau latéral, synchronisée en temps réel pour tous les joueurs à la table.

---

## Stack technique

- **React 18** + **TypeScript**
- **Vite** (dev server + build)
- **Tailwind CSS v3**
- **@owlbear-rodeo/sdk**

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

### 3. Installer Tailwind CSS v3

```bash
npm install tailwindcss @tailwindcss/vite
```

### 4. Configurer Tailwind

Dans **`vite.config.ts`**, remplace le contenu par :

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

### 5. Injecter les directives Tailwind dans le CSS global

Dans **`src/index.css`**, remplace tout le contenu par :

```css
@import "tailwindcss";

/* ── Nimble design tokens ─────────────────────────────────── */

@layer components {
  /* Bento card — la brique de base du layout */
  .bento-card {
    @apply rounded-xl border border-stone-700/60 bg-stone-900/50 p-3 backdrop-blur-sm;
  }

  /* Label de section à l'intérieur d'une bento-card */
  .bento-label {
    @apply text-[10px] font-semibold uppercase tracking-widest text-stone-500;
  }
}

/* Scrollbar fine pour l'onglet de contenu */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #44403c transparent;
}
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: #44403c;
  border-radius: 2px;
}

/* ── Base resets pour l'environnement OBR iframe ─────────────── */
* {
  box-sizing: border-box;
}
 
html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
 
body {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: #0c0a09; /* stone-950 */
}
 
/* Remove number input spinners (they clutter the stat boxes) */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}
 
```

### 6. Vérifier `src/main.tsx`

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

### 7. Configurer Vite pour l'extension OBR

Dans **`vite.config.ts`**, remplace le contenu par :

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // HTTPS requis par OBR pour le développement local
    https: true,
    port: 5173,
    cors: true,
  },
  // Le manifest OBR doit être servi depuis /public
  publicDir: 'public',
})
```

> **Pourquoi HTTPS ?** OBR charge les extensions dans une iframe et impose une origine HTTPS même en local. Vite génère un certificat auto-signé — accepte l'exception de sécurité dans ton navigateur la première fois.

---

## Copier les fichiers du projet

Place les fichiers générés dans la structure suivante :

```
nimble-obr/
├── public/
│   ├── manifest.json          ← manifest de l'extension OBR
│   └── icon.svg               ← icône (à créer, voir ci-dessous)
├── src/
│   ├── types/
│   │   └── character.ts
│   ├── utils/
│   │   └── formulaParser.ts
│   ├── hooks/
│   │   └── useOBR.ts
│   ├── components/
│   │   ├── ui/
│   │   │   ├── StatBox.tsx
│   │   │   ├── DiceRollModal.tsx
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

### Icône minimale (public/icon.svg)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="16" fill="#1c1917"/>
  <text x="50" y="68" text-anchor="middle" font-size="56" font-family="serif">🎲</text>
</svg>
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

### Qui peut modifier quoi ?

| Rôle | Peut modifier |
|------|--------------|
| Joueur — propriétaire du token | Sa propre fiche |
| GM | Toutes les fiches |
| Joueur — autre token | Lecture seule |

---

## Formules supportées

Le parser de formules (`src/utils/formulaParser.ts`) supporte :

| Syntaxe | Exemple | Résultat |
|---------|---------|----------|
| Dés | `1d8`, `2d6` | tirage aléatoire |
| Stats | `STR`, `DEX`, `INT`, `WIL` | valeur du personnage |
| Compétences | `MIGHT`, `STEALTH`, `ARCANA`… | valeur de la compétence |
| Niveau | `LEVEL` | niveau actuel |
| Maths | `+`, `-`, `*`, `/` | opérations de base |
| Arrondi | `floor(LEVEL/5)` | arrondi inférieur |
| Combiné | `1d10 + STR + floor(LEVEL/5) * 5` | formule avancée |

> `eval()` n'est **jamais** utilisé — le parser est un descent récursif maison.

---

## Prochaines étapes (roadmap)

- [ ] Onglet traduction FR/EN
- [ ] Sélection de classe avec pré-remplissage des stats de départ
- [ ] Partage du log de dés via OBR broadcast
- [ ] Thème clair "parchemin" optionnel
- [ ] Import/export JSON de la fiche
- [ ] Raccourcis clavier pour les lancers fréquents

---

## Ressources

- [OBR SDK docs](https://extensions.owlbear.rodeo/docs)
- [Vite docs](https://vitejs.dev)
- [Tailwind CSS v3](https://v3.tailwindcss.com)
- [Nimble TTRPG](https://nimble-ttrpg.com) *(lien à confirmer)*
