# Migration moteur Galahad — cadrage VPS (2026-07-05)

*Cadrage écrit par la session Claude du 2026-07-05 à la demande d'Alexandre. AUCUNE bascule exécutée — document de décision. Le moteur = ce repo (`/opt/claude-bridge/workspace/galahad`, 2 commits, MIT).*

## Constat

Le moteur Galahad et le homebrew VPS partagent le même ADN — mêmes modules (`agent-loop`, `journal`, `telegram`, `brain`, `memory`, `hooks`, `heartbeat`, `tools`, `config`) :

| Rôle moteur | Équivalent VPS actuel | Où |
|---|---|---|
| 🛡️ Guardian (patrol + QA, protocole radar, ETAT_DU_MONDE) | **dantalos** (`talos.service`, systemd) | /opt/talos |
| 🛰️ Traveler (veille + objectifs, night-shift) | **danhulysse** (`hulysse.service`) | /opt/hulysse |
| 🎩 Chef (orchestrateur humain-facing) | **danhermes** (produit Nous Hermes, Docker Coolify) | conteneur hermes-agent |
| 🧠 Claude bridge | **claude-bridge.service** (déjà en prod !) | /opt/claude-bridge |
| cockpit/ | **hermes-cockpit** (Coolify, cockpit.powerupgraders.com) | déjà en prod |

Le commit 2 du moteur (« Guardian restructure avec protocole radar ») montre que le moteur a déjà ABSORBÉ des évolutions du homebrew. La migration = converger les agents systemd vers le moteur conteneurisé unifié (une image, des rôles), PAS réécrire.

## Deltas à réconcilier AVANT toute bascule

1. **Greffes récentes côté VPS absentes du moteur** : `src/danmem.js` (auto-observe) + hook dans `agent-loop.js` (posés 2026-07-05) → à porter dans `engine/src/` d'abord.
2. **dan-brain** (cerveau à chaud via `data/cerveau.txt`, whitelist, cockpit `*/2`) vs `/brain <model>` du moteur → fusionner (le moteur doit lire/écrire le même fichier ou dan-brain doit piloter les conteneurs).
3. **fallback-watch.sh** + fichiers de débounce d'alerte → le moteur doit produire le même format `/data/agent-status/` pour le cockpit.
4. **Radar MCP** (mcp.js, talos uniquement) → vérifier que le rôle guardian du moteur l'embarque.
5. **veille.js / goals.js** (hulysse) vs traveler → mapper les fonctions.
6. **Deux cockpits** : celui du moteur vs hermes-cockpit en prod → décision : garder hermes-cockpit (prod, cartes Galahad déjà branchées), ignorer cockpit/ du moteur en P1.
7. **Chef ≠ danhermes** : migrer Dan du produit Nous Hermes vers le chef maison = perdre les toolsets/MCP/profils du produit (équipe ADVE !). Recommandation ferme : **PAS en phase 1** — décision produit séparée.

## Plan par phases (chacune réversible)

- **P0 — Préparation (sans bascule, exécutable à froid)** : porter danmem.js + hook dans engine/src ; build de l'image ; `.env` depuis dan-vault ; compose adapté VPS (volumes data des agents EXISTANTS montés en lecture au début) ; le tout à blanc.
- **P1 — Guardian ⇄ dantalos** : conteneur guardian en parallèle (patrouille lecture seule, PAS de Telegram), comparaison 48 h des journaux ; puis bascule du bot Telegram, `systemctl disable --now talos` (unit et code CONSERVÉS = rollback en une commande).
- **P2 — Traveler ⇄ danhulysse** : même protocole.
- **P3 — Chef / danhermes** : décision d'Alexandre avec critères (valeur des toolsets produit vs contrôle total maison ; l'équipe ADVE vit dans le produit).
- **P4 — Consolidation** : units homebrew archivées (jamais supprimées), doc, registre projets, mémoire.

## Prérequis bloquants

1. **Quotas LLM rechargés** (aucun test de comportement possible à sec — c'est ce qui a interdit toute bascule le 2026-07-05).
2. Fenêtre de supervision d'Alexandre (bascules P1/P2).
3. P0 terminé et revu.

## GO/NOGO par phase

GO si : le rôle conteneurisé reproduit 48 h de journaux équivalents ; alertes fallback visibles au cockpit ; danmem observe actif ; rollback testé une fois. NOGO → on reste sur le homebrew (qui marche).
