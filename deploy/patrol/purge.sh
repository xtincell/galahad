#!/bin/bash
set -uo pipefail
DIR=/opt/galahad/patrol
FILES="/home/talos/talos/data/patrol-findings.md /home/hulysse/hulysse/data/patrol-findings.md"
BODY=""
for f in $FILES; do [ -s "$f" ] && BODY="$BODY

=== $(echo "$f"|cut -d/ -f3) ===
$(cat "$f")"; done
if [ -z "${BODY// }" ]; then echo "$(date -u +%FT%TZ) rien a purger" >> "$DIR/purge.log"; exit 0; fi
PROMPT="Analyste de patrouille Galahad. Voici les constats bruts des vigiles (Talos infra/QA, Hulysse veille) depuis la derniere purge. Analyse, tri vrais problemes vs bruit, AGIS/corrige si c'est de ton ressort (sinon dis precisement quoi faire), et produis un RAPPORT DE SYNTHESE concis et actionnable en francais pour Alexandre. Constats:$BODY"
OUT=$(python3 /opt/talos/bin/convoque-claude.py "$PROMPT" 2>/dev/null)
[ -z "$OUT" ] && OUT="(Claude muet — constats bruts:)$BODY"
{ echo; echo "## Purge $(date -u +%FT%TZ)"; echo "$OUT"; } >> "$DIR/daily-report.md"
for f in $FILES; do [ -s "$f" ] && { { echo "--- $(date -u +%FT%TZ) $f ---"; cat "$f"; } >> "$DIR/findings-archive.md"; : > "$f"; }; done
echo "$(date -u +%FT%TZ) purge OK" >> "$DIR/purge.log"
