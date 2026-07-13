#!/bin/bash
# Deliverables watchdog (Galahad P1) — zero LLM. The check that would have caught the
# 6-day silence: it verifies the evening delivery pipeline actually RAN today, and shouts
# on Telegram if it didn't. "Silence si rien" must never again mean "silence toujours".
#
# Runs at 19:30 (30 min after deliver.sh's 19:00 slot). If deliver.sh left no trace for
# today in its log — whether it delivered a report OR legitimately had nothing to deliver —
# then the 19:00 cron did not fire, and that is exactly the failure we must surface.
set -uo pipefail
DIR=/opt/galahad/patrol
LOG="$DIR/deliver.log"
PURGELOG="$DIR/purge.log"
VOL="/var/lib/docker/volumes/cwqendl9ptwwjoznzr77qcix_hermes-home/_data"
TODAY=${WATCHDOG_TODAY:-$(date -u +%F)}   # override for testing the alert path

alert() {
  local msg="$1"
  local bot chat=591589257
  bot=$(grep -oE '[0-9]{8,}:[A-Za-z0-9_-]{30,}' "$VOL/.env" 2>/dev/null | head -1)
  [ -z "$bot" ] && { echo "$(date -u +%FT%TZ) WATCHDOG could not find bot token" >> "$DIR/watchdog.log"; exit 1; }
  curl -s "https://api.telegram.org/bot$bot/sendMessage" \
    --data-urlencode chat_id="$chat" \
    --data-urlencode text="🚨 WATCHDOG Galahad — $msg" >/dev/null
  echo "$(date -u +%FT%TZ) ALERT: $msg" >> "$DIR/watchdog.log"
}

# Did deliver.sh run today at all? (any line stamped with today's UTC date)
if grep -q "^$TODAY" "$LOG" 2>/dev/null; then
  # It ran. Extra sanity: warn if purge never ran today either (findings would silently pile up).
  if ! grep -q "^$TODAY" "$PURGELOG" 2>/dev/null; then
    alert "la livraison du soir a tourné mais AUCUNE purge aujourd'hui (${TODAY}) — les constats s'accumulent. Vérifie le cron purge 8h/18h."
  else
    echo "$(date -u +%FT%TZ) OK: purge+deliver ont tourné aujourd'hui" >> "$DIR/watchdog.log"
  fi
else
  alert "PAS de livraison du soir aujourd'hui (${TODAY}) — le cron 19h n'a pas tourné (ou deliver.sh a échoué avant de logger). C'est la panne qui a causé 6 jours de silence en juillet. Vérifie /etc/cron.d/galahad-patrol (champ utilisateur !) et deliver.log."
fi
