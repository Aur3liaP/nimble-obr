# 🎲 Nimble Character Sheet : OBR Extension

*Lire en [anglais / English](README.md).*

Extension Owlbear Rodeo pour jouer au TTRPG **Nimble**. Fiche de personnage interactive en panneau latéral, synchronisée en temps réel pour tous les joueurs à la table.

---

## Stack technique

- **React 19** + **TypeScript**
- **Vite** (dev server + build)
- **Tailwind CSS v4** (configuré en CSS, pas de `tailwind.config.js`)
- **@owlbear-rodeo/sdk** (v3.1.0)
- **Vitest** pour les tests unitaires

---

## 🤖 AI-Augmented Engineering

Ce projet a été développé avec une approche **AI-Augmented Engineering** (développement assisté par LLM), et sert aussi de terrain d'entraînement personnel à l'utilisation avancée de l'IA en contexte professionnel. Il s'est fait en deux phases nettement différentes, avec deux méthodes de travail différentes.

### Phase 1 : Claude en conversation (l'essentiel du projet)

Architecture générale, schéma de données, maquette de design et toutes les décisions de game design ont été faites à la main. Le code des composants React/Tailwind a été généré par itération avec Claude en conversation, à partir de specs détaillées et d'un contexte injecté manuellement : documentation du SDK OBR, règles officielles de Nimble extraites du PDF de référence pour que les sorts/objets générés respectent fidèlement le livre. Le contrôle s'exerçait naturellement : chaque ligne passait par une relecture et une intégration manuelle avant d'entrer dans le repo.

### Phase 2 : Claude Code en agent (reprise du projet)

La méthode a changé à la reprise : Claude Code écrit directement dans le repo (nouvelles fonctionnalités, refactors, tests), et le rôle du développeur devient la revue critique plutôt que la relecture ligne à ligne. Le levier n'est plus la relecture de chaque diff au moment où il s'écrit, mais :

- des prompts précis et un contexte projet structuré (`CLAUDE.md`, à la racine du repo, qui documente les décisions à ne pas "corriger" et les raisons derrière elles) ;
- la revue des sorties produites, pas seulement du code mais du raisonnement fourni ;
- des garde-fous automatisés : suite de tests (voir [Tests et CI](#tests-et-ci)), invariants qui cassent volontairement quand une étape est oubliée (ex. le test `MIGRATIONS invariant` du système de [versionnage de schéma](#versionnage-de-schéma)).

Ce qui ne change pas entre les deux phases : rien n'est accepté sans être relu et testé à la main. En phase 2, plusieurs propositions de l'agent ont été refusées ou corrigées après vérification, et plusieurs bugs ont été trouvés par des tests manuels multi-clients dans OBR, pas par la suite automatisée. Trois exemples concrets de ce que cette revue a attrapé, aucun n'aurait été détecté par un test ou un type-check :

- **`LVL`** : l'agent proposait de corriger la donnée dans `spells.ts` en réécrivant `LVL` en `LEVEL`, en traitant la notation du livre comme une faute de frappe. La bonne correction était d'ajouter `LVL` comme alias dans le parser (voir `VARIABLE_TABLE` dans `formulaParser.ts`) : réécrire la donnée aurait laissé le même piège pour le prochain MJ écrivant une formule custom avec cette abréviation officielle.
- **`actionsUsed` renommé en `actionsRemaining`** : le champ comptait les actions dépensées, alors que ce qu'un joueur suit réellement à la table, c'est ce qu'il lui reste. Le sens de décompte était inversé (lancer 1 action mettait le compteur à 2 au lieu de 1). Trouvé en jouant avec la fiche, pas en relisant le code.
- **Le reset du tracker d'actions** : l'agent proposait de le lier au jet d'initiative, en s'appuyant sur une règle inexacte (l'initiative se lance une fois par combat en Nimble, pas à chaque round). Rejeté sur la base de la connaissance du jeu, pas du code.

### Ce que la phase 2 a révélé sur la phase 1

Le retour d'expérience le plus intéressant du projet : la rigueur de la phase 2 (tests systématiques, CLAUDE.md documentant chaque garde-fou, JSDoc exigeant de justifier le "pourquoi") a mis au jour plusieurs bugs silencieux introduits en phase 1, présents dans le code depuis des semaines sans qu'aucun test rouge ni aucune erreur de type-check ne les signale :

- **Le garde-fou anti-DoS du parser de formules ne protégeait que l'affichage.** Une limite sur le nombre de dés et leurs faces (`assertDiceWithinLimits`) avait été ajoutée sur le chemin d'affichage (`diceToAverage`) mais pas sur le chemin de résolution des dés dynamiques (`resolveDynamicDice`), qui alimente à la fois l'affichage *et* le jet réel. Un jet réel n'était donc pas protégé par la limite censée le couvrir.
- **Trois notations officielles du livre étaient silencieusement rejetées.** `d66` (dé à comptage implicite, sans "1" devant), `KEYd20` (variable collée à une notation de dé : la frontière `\b` de regex ne détecte pas de rupture entre "Y" et "D", deux caractères de mot) et `LVL` (abréviation utilisée par le livre lui-même) échouaient toutes les trois à la lecture, alors que le contenu était juste : c'est le parser qui était trop strict.
- **La variable `FLAW` était documentée, mais jamais câblée.** Elle apparaissait dans le README et dans `buildContext`, sans aucune ligne de substitution dans le parser : une formule l'utilisant ne se serait jamais évaluée correctement.
- **Plusieurs dégradations silencieuses vers 0 masquaient des erreurs.** Un jeton de formule inconnu, un résultat `NaN`, un compte de dés à 0 : tous retournaient un `0` d'apparence légitime au lieu d'échouer bruyamment, ce qui est particulièrement dangereux pour un lanceur de dés diffusé à toute la table.
- **Un `updateItems` résolu ne prouve pas que la table a reçu le changement.** Le SDK OBR communique avec son hôte exclusivement par `window.postMessage` entre l'iframe de l'extension et la fenêtre parente, un mécanisme qui ne touche jamais la couche réseau. `updateItems`/`setMetadata` se résolvent dès que l'hôte a appliqué le changement à son état de scène local, ce qui n'est pas la même chose que le relais effectif vers le serveur multijoueur par le WebSocket de l'hôte. Réseau coupé, `updateItems` continue de se résoudre normalement pendant que le WebSocket de l'hôte est fermé. C'est un vrai angle mort de l'extension (voir `SyncStatus` dans `useOBR.ts`), pas une supposition.
- **Des affirmations sur la synchronisation avaient divergé de ce que le code garantissait réellement.** Ce README lui-même affirmait qu'une écriture "se propage instantanément à tous les clients connectés" ; c'est vrai pour le cas courant, mais faux dans le sens absolu où la phrase le laissait entendre, pour la raison ci-dessus.

Le point commun à tous ces bugs : aucun n'était visible dans des tests verts ou un type-check propre, et plusieurs venaient d'une mesure de sécurité placée à un endroit plausible mais inefficace. C'est une limite réelle de la méthode de la phase 1 (contexte injecté manuellement, mais pas de suite de tests pour vérifier les invariants dans la durée), et la documenter renforce cette section plutôt que de l'affaiblir : c'est précisément ce que la rigueur de la phase 2 (garde-fous automatisés, JSDoc qui doit justifier chaque décision) a été mise en place pour éviter à l'avenir.

### Limites assumées

Le contrôle porte sur les décisions structurantes (architecture, schéma de données, game design, permissions) et sur la revue des sorties, pas sur chaque choix d'implémentation interne : plusieurs détails techniques ont bien été décidés en autonomie par l'agent et validés après coup plutôt qu'avant, par exemple le choix de réécrire une migration de schéma dans un effet dédié plutôt qu'au moment du chargement (voir `useOBR.ts`), ou un compteur interne (`armIdRef` dans `useDeleteUndo.ts`) pour invalider un timer d'undo devenu obsolète. Chaque changement touchant aux **permissions** (`canEdit`, `ownerId`) ou à la synchronisation multijoueur a en revanche été testé à la main dans OBR avec plusieurs comptes simultanés (un MJ + plusieurs joueurs) avant d'être validé : `type-check` + `lint` + tests verts est la barre pour "fini" côté code, mais pas une preuve suffisante pour ce qui touche au multijoueur, où il n'existe pas de substitut automatisé.

---

## Prérequis

- **Node.js ≥ 18** (LTS recommandé)
- **npm ≥ 9** (ou pnpm / yarn si tu préfères)
- Un compte [Owlbear Rodeo](https://www.owlbear.rodeo/) pour tester l'extension

---

## Démarrage rapide

```bash
npm install
npm run dev
```

Le terminal affiche une URL du type `https://localhost:5173`. C'est celle-là qu'on enregistre dans OBR (voir ci-dessous). Le projet n'a pas besoin d'être recréé de zéro : cette commande suffit. Pour l'historique de comment le projet a été échafaudé à l'origine (Vite + React + TS + Tailwind), voir [docs/dev-setup-from-scratch.md](docs/dev-setup-from-scratch.md).

---

## Enregistrer l'extension dans Owlbear Rodeo

1. Ouvre [owlbear.rodeo](https://www.owlbear.rodeo/) et crée une partie (ou ouvre une existante).
2. Dans le menu latéral gauche, clique sur l'icône **Extensions** (puzzle piece).
3. Clique sur **"Add Extension"**.
4. Entre l'URL du manifest :
   - en développement local, `https://localhost:5173/manifest.test.json` (`public/manifest.test.json`, nommé "[DEV]" pour se distinguer de la version installée en production dans la liste des extensions) ;
   - pour utiliser la version publiée, `https://nimble-obr.vercel.app/manifest.json` (déployée depuis la branche `main`).
5. En local, accepte le certificat HTTPS si ton navigateur te l'affiche (visite `https://localhost:5173` directement une fois).
6. L'extension apparaît dans le menu, clique dessus pour ouvrir le panneau.

> **Après une mise à jour de l'extension déjà installée**, recharge la page OBR (F5) avant de rouvrir le panneau. Le schéma de la fiche est versionné (voir [Versionnage de schéma](#versionnage-de-schéma)) : un onglet resté ouvert depuis avant la mise à jour peut se retrouver face à une fiche migrée par un client plus récent, et affichera alors un message demandant de recharger plutôt que de deviner un champ qu'il ne connaît pas encore.

---

## Build de production

```bash
npm run build
```

Les fichiers statiques sont dans `dist/`. La version publiée est déployée sur **Vercel** depuis la branche `main`, à `https://nimble-obr.vercel.app`. D'autres hébergeurs de statique conviendraient aussi (Netlify par drag & drop de `dist/`, GitHub Pages avec `base: '/nimble-obr/'` dans `vite.config.ts`), mais impliqueraient de changer les URLs `manifest`/`image`/`icon` de [docs/store.md](docs/store.md), qui doivent rester synchronisées avec l'URL réellement déployée.

---

## Structure du projet

```
nimble-obr/
├── public/
│   ├── manifest.json          ← manifest de production
│   ├── manifest.test.json      ← manifest "[DEV]" pour le développement local
│   └── icon.svg                ← icône de l'extension
├── docs/
│   ├── schema-migrations.md    ← versionnage et migration de la fiche
│   ├── dev-setup-from-scratch.md
│   └── store.md                 ← fiche de la boutique d'extensions OBR
├── src/
│   ├── types/
│   │   └── character.ts        ← types du domaine (NimbleCharacter, etc.)
│   ├── utils/
│   │   ├── formulaParser.ts    ← parseur de formules + moteur de dés
│   │   ├── characterMigrations.ts  ← migrations de schéma
│   │   └── entryUndo.ts        ← logique pure de l'undo de suppression
│   ├── data/
│   │   ├── spells.ts           ← sorts officiels (BASE_SPELLS)
│   │   └── equipment.ts        ← équipement officiel (BASIC_EQUIPMENTS)
│   ├── hooks/
│   │   ├── useOBR.ts           ← intégration SDK OBR (état, permissions, sync, rolls)
│   │   ├── useDeleteUndo.ts    ← undo de suppression (spells/items/actions)
│   │   ├── useDraggableValue.ts
│   │   ├── useFormulaField.ts  ← champ de formule à commit différé
│   │   └── useSearchFilter.ts
│   ├── components/
│   │   ├── ui/
│   │   │   ├── common/          ← composants réutilisables (BentoSection, FormField, FormulaHelp…)
│   │   │   ├── StatBox.tsx
│   │   │   ├── DiceRollModal.tsx
│   │   │   ├── DicePanel.tsx
│   │   │   ├── RollLog.tsx
│   │   │   ├── SyncStatusBanner.tsx
│   │   │   ├── DeleteUndoToast.tsx
│   │   │   └── LanguageSelector.tsx
│   │   └── tabs/
│   │       ├── SummaryTab.tsx
│   │       ├── CombatTab.tsx
│   │       ├── SpellsTab.tsx
│   │       └── InventoryTab.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Architecture des données

La fiche est stockée dans les **metadata** du token OBR sous la clé :

```
com.nimble-obr.nimble/character_sheet
```

Ce namespace unique évite les conflits avec d'autres extensions. Toute modification appelle `OBR.scene.items.updateItems()`.

L'historique des lancés de dés (visibles par toute la table) est stocké séparément dans les **metadata de la scène**, sous une clé dérivée du même namespace, et plafonné à 20 entrées.

### Versionnage de schéma

La fiche (`NimbleCharacter`) porte un `schemaVersion`. Un choke point unique (`migrateCharacter`) fait passer un enregistrement ancien à la version courante, refuse un enregistrement écrit par un client plus récent (`"unsupported"`, message "reload the page"), et refuse un enregistrement corrompu même après migration (`"invalid"`). La procédure complète pour ajouter un champ, ce qui se passe côté clients au moment d'un déploiement, et les limites connues de la validation de forme sont documentées dans [docs/schema-migrations.md](docs/schema-migrations.md).

### Qui peut modifier quoi ?

| Rôle | Peut modifier |
|------|--------------|
| Joueur, propriétaire du token (`ownerId`) | Sa propre fiche |
| GM | Toutes les fiches, indépendamment de `ownerId` |
| Joueur, autre token | Lecture seule (boutons d'édition masqués, pas seulement désactivés) |

Cette permission est centralisée dans un objet `permissions` (`{ canEdit, isGM, isOwner, isUnclaimed }`), calculé une seule fois dans `useOBR` et propagé explicitement en props à chaque composant interactif : il ne se propage jamais "automatiquement" via le contexte React, ce qui nécessite une vérification systématique de chaque nouveau composant ajouté.

**Garde côté écriture** : `updateCharacter` (dans `useOBR`) revérifie `canEdit` avant chaque appel à `OBR.scene.items.updateItems`, et abandonne silencieusement (avec un `console.warn`) si l'appelant n'a pas les droits. Ce n'est pas une vraie barrière de sécurité, OBR n'a pas d'ACL serveur sur les metadata, donc un joueur déterminé pourrait toujours écrire via les devtools, mais ça évite les écritures accidentelles déclenchées par un état UI obsolète.

**Lancer un dé reste possible en lecture seule** : lancer un dé n'est volontairement pas soumis à `canEdit`, un joueur qui regarde la fiche d'un autre peut quand même lancer un dé avec ses stats. Seule la persistance de modifications sur la fiche elle-même passe par la garde de `updateCharacter`.

**"Claim" / "Take over"** : réclamer ou reprendre une fiche n'est pas non plus gardé par `canEdit`, puisque c'est justement le point d'entrée qui accorde les droits d'édition. Actuellement, n'importe quel joueur peut reprendre la fiche d'un autre joueur déjà réclamée (choix délibéré pour une table de confiance entre amis) ; si ce comportement doit être restreint au GM, la garde doit être ajoutée côté bouton dans `App.tsx`/`CharacterHeader.tsx`.

### Feedback de synchronisation

Chaque écriture vers OBR est suivie (`SyncStatus` dans `useOBR`) et remonte dans un bandeau discret en haut du panneau :
- rien ne s'affiche pour une écriture normale (l'état "idle" est le cas courant, une écriture réussie ne doit pas s'afficher) ;
- un indicateur "Saving…" apparaît si une écriture est en vol plus longtemps que prévu ;
- un bandeau "hors ligne" s'affiche si `navigator.onLine` est faux ; la fiche reste utilisable localement (jets, brouillons de formule) mais rien n'est diffusé à la table tant que la connexion n'est pas revenue ;
- un échec d'écriture affiche un bandeau persistant avec un bouton "Retry", qui reste affiché jusqu'à un retry réussi ou un dismiss explicite.

Ce mécanisme couvre les erreurs remontées par l'hôte OBR et la perte totale d'interface réseau. Il ne couvre pas la coupure du relais WebSocket de l'hôte OBR vers le serveur multijoueur pendant que le réseau reste up : voir la note sur `updateItems` plus haut, dans la section AI-Augmented Engineering.

---

## Formules supportées

Le parser de formules (`src/utils/formulaParser.ts`) supporte :

| Syntaxe | Exemple | Résultat |
|---------|---------|----------|
| Dés | `1d8`, `2d6` | tirage aléatoire |
| Dé à comptage implicite | `d20`, `d12`… | notation du livre sans compte explicite, normalisée en `1dN` |
| Dés positionnels | `d44`, `d66`, `d88`, variante avantage `d66a` | 2e édition : deux dés (trois pour `a`, en gardant les 2 meilleurs sans les retrier) lus positionnellement (dizaine/unité), ex. 4 puis 5 → 45. Ne ratent ni ne critiquent jamais. |
| Stats | `STR`, `DEX`, `INT`, `WIL` | valeur du personnage |
| Stat clé / défaut | `KEY`, `FLAW` | valeur de la stat marquée clé/défaut |
| Compétences | `MIGHT`, `STEALTH`, `ARCANA`… | valeur de la compétence |
| Niveau | `LEVEL`, `LVL` (alias du livre) | niveau actuel |
| PV | `HP`, `MAXHP` | points de vie actuels / maximum |
| Maths | `+`, `-`, `*`, `/` | opérations de base |
| Arrondi | `floor(LEVEL/5)`, `ceil(...)` | arrondi inférieur/supérieur |
| Min/Max | `min(a, b)`, `max(a, b)` | valeur min/max |
| Dés dynamiques | `incrementdice(1, level)d12`, `stepdice(level, 4, 8, 10, 12)` | dés évolutifs avec le niveau |
| Combiné | `1d10 + STR + floor(LEVEL/5) * 5` | formule avancée |

Un panneau d'aide intégré (bouton "?" à côté de chaque champ de formule) documente cette même liste ainsi que des exemples réels tirés des sorts/objets du jeu. Cette liste n'est jamais recopiée à la main dans l'UI : elle est générée par réflexion sur les tables internes du parser, précisément pour éviter qu'une variable documentée ne se retrouve jamais câblée (voir `FLAW` plus haut).

**Limites de sécurité** : une formule est limitée à 200 caractères et 30 niveaux d'imbrication ; un jet est limité à 100 dés maximum, chacun à 1000 faces maximum. Ce sont des garde-fous contre une formule mal formée ou malveillante, pas des limites d'équilibrage : un sort légal de personnage niveau 20 en est très loin.

> `eval()` n'est **jamais** utilisé, le parser est un descent récursif maison, pour éviter tout risque d'exécution de code arbitraire via une formule tapée par un joueur ou le MJ.

---

## Tests et CI

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
```

Une suite Vitest couvre les fonctions pures du projet (aucune dépendance au SDK OBR) : le parser de formules, les migrations de schéma, la logique de l'undo de suppression, et la logique de filtrage de recherche partagée entre les onglets Inventaire et Sorts. Elle tourne dans `.github/workflows/ci.yml` sur chaque pull request et sur push vers `main`/`dev` (type-check + lint + tests).

Ce que la suite ne couvre pas, par construction : tout ce qui touche à la synchronisation multi-clients réelle, aux permissions en situation (plusieurs comptes OBR simultanés), et à l'UI elle-même. Ces changements-là passent par une vérification manuelle à plusieurs comptes dans OBR, il n'existe pas de substitut automatisé pour ça dans ce projet.

---

## Accessibilité

Indicateurs de focus clavier visibles sur les éléments interactifs (curseurs de barre HP/Mana, boutons d'action), et labels `aria-label` sur les boutons qui n'affichent qu'une icône (actions de ligne, dismiss d'un bandeau, suppression d'une langue). Ce n'est pas un audit d'accessibilité complet, seulement les correctifs ciblés faits à ce jour.

---

## Undo de suppression

Supprimer un sort, un objet ou une action est immédiat et diffusé à la table, sans confirmation. En contrepartie, un toast local (visible seulement du client qui a supprimé) permet d'annuler pendant quelques secondes. Un seul niveau d'annulation à la fois : une nouvelle suppression pendant que le toast est affiché remplace l'annulation en attente plutôt que d'empiler un historique.

---

## Prochaines étapes (roadmap)

- [ ] Onglet traduction FR/EN
- [ ] Sélection de classe avec pré-remplissage des stats de départ
- [ ] Panneau d'extension repositionnable / détachable (recherche en cours sur le SDK OBR)
- [ ] Thème clair "parchemin" optionnel
- [ ] Import/export JSON de la fiche
- [ ] Raccourcis clavier pour les lancers fréquents

---

## Licence

Nimble OBR is an independent product published under the Nimble 3rd Party Creator License. Nimble TTRPG (c) Nimble Co.

---

## Ressources

- [OBR SDK docs](https://extensions.owlbear.rodeo/docs)
- [Vite docs](https://vitejs.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Nimble TTRPG](https://nimble-ttrpg.com)
