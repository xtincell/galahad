# FABLE — agent de pilotage autonome de l'infra danhermes (Claude headless)

Cousin de NEFER (La Fusée). Se réveille par cron, patrouille l'infra via le Sas Admin,
répare le réversible, escalade le strictement nécessaire. Identité/doctrine : wiki `FABLE.md` ;
protocole : wiki `Contingences.md` ; mission : wiki `Prise_en_main_Fable.md`.

## Architecture
- **Runtime** : `claude -p` headless sous l'user `claudebridge` (réutilise son auth ; PAS d'OAuth dédié).
  ⚠️ `--permission-mode bypassPermissions` ⇒ le hook PreToolUse est l'UNIQUE garde-fou.
- **Workspace** : `/opt/fable/workspace/` (owner claudebridge) — `CLAUDE.md` auto-chargé = ancrage.
- **Garde-fou** : `.claude/hooks/guard.py` (PreToolUse:Bash) — bloque destructif/payant sans
  consentement (fenêtre `bin/fable-grant.sh <min>`, file-backed) + anti-exfil. Journalisé.
- **Escalade** : `bin/fable-escalate.sh` — Telegram + email (google-bridge) + note wiki `Fable_Escalades.md`.
- **Patrouille** : `bin/fable-patrol.sh` — silence si rien (`RAS`) ; escalade l'échec du réveil lui-même.
- **Cron (root)** : `host-bin/fable-cron.sh` → auto-heal auth root→claudebridge puis patrouille.

## Install
1. `install -d -o claudebridge -g claudebridge /opt/fable/workspace` ; copier `workspace/` dedans
   (préserver owner claudebridge ; `chmod 755` les `bin/*` et le hook).
2. Token sas 1 an → `/opt/fable/workspace/.fable-token` (600, claudebridge).
3. `escalation.env.example` → `.claude/escalation.env` rempli (600, claudebridge).
4. `host-bin/fable-cron.sh` → `/opt/fable/bin/fable-cron.sh` (root, 744).
5. Cron 6 h : `0 */6 * * * root /opt/fable/bin/fable-cron.sh >> /var/log/fable-patrol.log 2>&1`
   dans `/etc/cron.d/galahad-fable`.
6. Test : `sudo -u claudebridge -H /opt/fable/workspace/bin/fable-patrol.sh` → doit finir par `RAS`.

## Pièges connus (détail : LESSONS.md §3.8)
- Cron en **claudebridge** obligatoire (un run root laisse journal.jsonl root-owned → PermissionError).
- `claude -p` exige `< /dev/null` ; l'auth headless peut tomber après un auto-update (auto-heal dans fable-cron.sh).
