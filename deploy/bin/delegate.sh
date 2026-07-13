#!/bin/bash
# delegate.sh <to_agent> <skill> [args_json] — Dan's delegation primitive (Galahad Phase 3).
# Dan has no direct handle on the directors; instead it POSTs a job to the danmem bus and
# the target director PULLS it on its heartbeat, runs the skill through the verified runtime,
# and writes the result back. This script does the POST + polls for the result. Dan calls it
# via admin_bash (it runs on the host, where danmem and its token live). No inbound port.
#
#   delegate.sh Talos diagnostic-coolify
#   delegate.sh Hulysse audit-coherence '{}'
set -uo pipefail
TO="${1:?usage: delegate.sh <to_agent> <skill> [args_json]}"
SKILL="${2:?skill required}"
ARGS="${3:-}"; [ -z "$ARGS" ] && ARGS='{}'   # NB: ${3:-{}} mis-parses (nested braces) → don't
TOK=$(grep -oP 'MEMORY_API_TOKEN=\K.*' /etc/danmem/danmem.env 2>/dev/null || true)
[ -z "$TOK" ] && { echo "delegate: cannot read danmem token"; exit 1; }
B=http://localhost:8790; H="Authorization: Bearer $TOK"

ID=$(curl -s -H "$H" -H 'Content-Type: application/json' -X POST "$B/jobs" \
  -d "{\"from\":\"dan\",\"to\":\"$TO\",\"skill\":\"$SKILL\",\"args\":$ARGS}" \
  | grep -oP '"id":\s*"?\K[0-9]+')
[ -z "$ID" ] && { echo "delegate: POST failed"; exit 1; }
echo "delegate: job $ID → $TO / $SKILL (waiting up to 120s)…" >&2

for _ in $(seq 1 40); do
  sleep 3
  R=$(curl -s -H "$H" "$B/jobs/$ID")
  ST=$(echo "$R" | grep -oP '"status":"\K[a-z]+' | head -1)
  if [ "$ST" = done ] || [ "$ST" = failed ]; then
    echo "$R" | python3 -c 'import json,sys
d=json.load(sys.stdin); r=d.get("result") or {}
print("["+(d.get("status") or "?")+"]", r.get("finding") or r.get("error") or json.dumps(r)[:600])'
    exit 0
  fi
done
echo "delegate: timeout waiting for job $ID (still $ST)"; exit 2
