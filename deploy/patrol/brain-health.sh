#!/usr/bin/env bash
# brain-health — sentinelle SANS LLM (audit 2026-07-10).
# Quand les cerveaux tombent (429 quota, 402 crédits, 5xx en série), les agents ne
# peuvent pas prévenir : c est le LLM qui est en panne. Ce script compte les erreurs
# cerveau dans les journaux et alerte Alexandre par l API Telegram brute (zéro token).
# Cron root */30. Cooldown 6 h pour ne pas spammer.
set -uo pipefail
STATE=/var/lib/galahad/brain-health.last
mkdir -p /var/lib/galahad
. /etc/talos/talos.env 2>/dev/null || exit 0
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || exit 0

native=$(journalctl -u talos -u hulysse --since "-35 min" --no-pager 2>/dev/null \
  | grep -cE "brain_fallback|heartbeat_brain_error|brain HTTP (429|402|5[0-9][0-9])")
dan_ct=$(docker ps -qf name=hermes-agent | head -1)
dan=0
[ -n "$dan_ct" ] && dan=$(docker logs "$dan_ct" --since 35m 2>&1 | grep -ciE "HTTP (429|402)|usage limit|rate limit" || true)
total=$((native + dan))
[ "$total" -ge 3 ] || exit 0

# Cooldown 6 h
now=$(date +%s); last=$(cat "$STATE" 2>/dev/null || echo 0)
[ $((now - last)) -ge 21600 ] || exit 0

msg="🧠🚨 Sentinelle cerveaux (sans LLM) : ${total} erreurs LLM en 35 min (agents natifs: ${native}, Dan: ${dan}).
Causes probables : quota Ollama Cloud (429) ou crédits fallback OpenRouter (402).
Les agents tournent peut-être en dégradé. Vérifier : cockpit → Cerveaux, ou ssh vps « journalctl -u talos -u hulysse | tail »."
curl -sm 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" --data-urlencode text="$msg" >/dev/null \
  && { echo "$now" > "$STATE"; logger -t brain-health "alerte envoyée (${total} erreurs)"; }
