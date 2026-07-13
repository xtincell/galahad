#!/bin/bash
# docker-firewall.sh — close only the Docker-published ports that are dangerous AND never
# needed from outside, WITHOUT ever locking the operator out of Coolify.
#
# WHY: there is no Hostinger cloud firewall and Docker's DNAT bypasses ufw (DOCKER-USER is
# where forwarded-to-container traffic is actually filtered). But the operator administers
# from many networks (Starlink / Camtel / Orange / VPN) with dynamic IPs, so an IP allowlist
# is the WRONG tool — it would lock him out on a new network. So:
#   • 8000 (Coolify dashboard) → INTERNAL ONLY. Coolify is reachable over HTTPS at its own FQDN
#     coolify.powerupgraders.com (443 → Traefik → internal), so the operator gets to it from ANY
#     network via that URL, and Dan reaches its API on localhost:8000 (loopback, unaffected by
#     this chain). The raw internet-facing port is therefore closed — verified both paths still
#     work and the external port times out.
#   • 8080 (Traefik API/dashboard — typically UNAUTHENTICATED, the real risk) and 8964 (an app
#     already served over 443 via its domain, so the raw port is redundant) → INTERNAL ONLY too.
#   • 6001/6002 (Coolify realtime) stay OPEN — they are NOT proxied through the FQDN, the browser
#     connects to them directly, so the operator's dashboard needs them reachable from any
#     network. App-key gated; minor residual. (Set PUSHER_HOST to the FQDN in Coolify to route
#     realtime over 443 too, then move 6001/6002 into INTERNAL_ONLY as well.)
#   80/443 (all apps + Coolify's own FQDN, via Traefik) and SSH/22 are untouched.
#
# ROBUSTNESS: matches the ORIGINAL destination port via conntrack (--ctorigdstport), NOT
# --dport. In DOCKER-USER the packet is already DNAT'd to the container IP:port, and those
# container IPs shuffle on every redeploy — matching the original published port is stable.
# Idempotent: deletes its own prior rules (incl. any legacy IP-allowlist rules) before
# re-adding, so it is safe to re-run and to re-apply after every Docker daemon restart.
set -uo pipefail
INTERNAL="10.0.0.0/8"
INTERNAL_ONLY="${INTERNAL_ONLY_PORTS:-8000 8080 8964}"   # closed to the world (8000 via FQDN/localhost)
OPEN_PORTS="${OPEN_PORTS:-6001 6002}"                    # realtime the browser needs from any network
CH=DOCKER-USER

command -v iptables >/dev/null || { echo "no iptables"; exit 1; }

# Comprehensive scrub: delete EVERY DOCKER-USER rule referencing one of our ports, whatever
# its source or target, by line number (bottom-up). Source-agnostic → re-runs never leave
# cruft, even from earlier experiments with different admin CIDRs.
scrub_port() {
  local p="$1"
  iptables -L "$CH" --line-numbers -n 2>/dev/null | awk -v pat="ctorigdstport $p\$" '$0 ~ pat {print $1}' \
    | sort -rn | while read -r n; do iptables -D "$CH" "$n" 2>/dev/null || true; done
}
for p in $OPEN_PORTS $INTERNAL_ONLY; do scrub_port "$p"; done

# Internal-only ports → allow Docker networks, drop the world (RETURN above DROP).
for p in $INTERNAL_ONLY; do
  m="-p tcp -m conntrack --ctorigdstport $p"
  iptables -I "$CH" $m -j DROP
  iptables -I "$CH" $m -s "$INTERNAL" -j RETURN
done
logger -t docker-firewall "applied: open=[$OPEN_PORTS] internal-only=[$INTERNAL_ONLY] (80/443 public, ssh untouched)"
echo "docker-firewall applied — open (any network): $OPEN_PORTS | internal-only: $INTERNAL_ONLY"
