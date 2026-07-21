#!/usr/bin/env bash
# FABLE — wrapper cron (root). 1) auto-heal de l'auth claude de claudebridge (LESSONS §3.3 :
# une session peut tomber après un auto-update ; on la resynchronise depuis la source de vérité
# root). 2) lance la patrouille en tant que claudebridge.
set -uo pipefail
SRC=/root/.claude/.credentials.json
DST=/home/claudebridge/.claude/.credentials.json

# auto-heal : si les creds claudebridge manquent ou sont plus vieux que ceux de root, resync.
if [ -f "$SRC" ]; then
  if [ ! -f "$DST" ] || [ "$SRC" -nt "$DST" ]; then
    install -d -o claudebridge -g claudebridge -m 700 /home/claudebridge/.claude
    install -o claudebridge -g claudebridge -m 600 "$SRC" "$DST"
    logger -t fable-cron "auth claudebridge resync depuis root"
  fi
fi

exec sudo -u claudebridge -H /opt/fable/workspace/bin/fable-patrol.sh
