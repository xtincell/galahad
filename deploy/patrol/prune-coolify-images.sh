#!/bin/bash
# prune-coolify-images.sh — daily hygiene (cron), zero LLM. Coolify apps that auto-deploy
# on every git push pile up a new ~0.3-1.8GB image per build and never clean the old ones;
# left alone the disk climbed to 91% on 2026-07-12. This keeps, per app, the RUNNING image
# plus the KEEP most-recent previous ones (rollback cushion) and removes the rest.
#
# Safe by construction: docker refuses to delete an image backing a running container, and
# app sources live in git (removed versions rebuild on the next deploy). Set DRY_RUN=1 to
# preview. Auto-discovers Coolify app repos (24-char lowercase-alnum id) with >KEEP+1 images.
set -uo pipefail
KEEP=${KEEP:-2}            # most-recent previous images to retain per app (besides the running one)
DRY_RUN=${DRY_RUN:-0}
log() { logger -t prune-coolify-images "$*" 2>/dev/null; echo "$*"; }

# Coolify app image repos = bare 24-char lowercase-alnum names (no registry host, no slash).
apps=$(docker images --format '{{.Repository}}' | grep -E '^[a-z0-9]{24}$' | sort -u)
freed_note=""
for app in $apps; do
  total=$(docker images "$app" -q | wc -l)
  [ "$total" -le $((KEEP + 1)) ] && continue
  cid=$(docker ps --filter "name=$app" -q | head -1)
  running=""
  [ -n "$cid" ] && running=$(docker inspect "$cid" --format '{{.Image}}' 2>/dev/null | sed 's/sha256://')
  ids=$(docker images "$app" --format '{{.CreatedAt}}|{{.ID}}' | sort -r | cut -d'|' -f2)
  kept=0; removed=0
  for id in $ids; do
    case "$running" in "$id"*) continue ;; esac      # never touch the running image
    if [ "$kept" -lt "$KEEP" ]; then kept=$((kept + 1)); continue; fi
    if [ "$DRY_RUN" = "1" ]; then echo "  [dry] would rm $app $id"; removed=$((removed + 1)); continue; fi
    docker rmi "$id" >/dev/null 2>&1 && removed=$((removed + 1))
  done
  [ "$removed" -gt 0 ] && freed_note="$freed_note $app:-$removed"
done
[ -n "$freed_note" ] && log "pruned stale app images:$freed_note ($(df -h / | awk 'NR==2{print $5" used"}'))"
exit 0
