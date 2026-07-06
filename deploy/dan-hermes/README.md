# Déploiement Dan-Hermes (service Coolify)

Définition **framework-native** du service `hermes-agent-with-webui` (image tierce `nousresearch/hermes-agent` + `hermes-webui`), tel que déployé sur le VPS.

Invariant clé (corrigé 2026-07-06) : **`HOME = HERMES_HOME = /opt/data`** — le volume de données `hermes-home` est monté sur `/opt/data` (home natif du framework), zéro patch d'image. Voir la mémoire `dan-hermes-home-wiki`.

Secrets : **jamais commités**. Ils sont injectés par l'environnement Coolify (ou un `.env` local non versionné). Voir `.env.example`.
