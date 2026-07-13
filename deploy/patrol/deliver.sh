#!/bin/bash
set -uo pipefail
DIR=/opt/galahad/patrol; R="$DIR/daily-report.md"
VOL="/var/lib/docker/volumes/cwqendl9ptwwjoznzr77qcix_hermes-home/_data"
[ -s "$R" ] || { echo "$(date -u +%FT%TZ) rien a livrer" >> "$DIR/deliver.log"; exit 0; }
BOT=$(grep -oE '[0-9]{8,}:[A-Za-z0-9_-]{30,}' "$VOL/.env" 2>/dev/null | head -1)
CHAT=591589257
[ -z "$BOT" ] && { echo "$(date -u +%FT%TZ) pas de token" >> "$DIR/deliver.log"; exit 1; }
MSG="🌙 Rapport de patrouille du soir (synthèse Claude) :
$(cat "$R")"
curl -s "https://api.telegram.org/bot$BOT/sendMessage" --data-urlencode chat_id="$CHAT" --data-urlencode text="$MSG" >/dev/null && mv "$R" "$DIR/delivered-$(date -u +%Y%m%d-%H%M).md"
echo "$(date -u +%FT%TZ) livre a $CHAT" >> "$DIR/deliver.log"
