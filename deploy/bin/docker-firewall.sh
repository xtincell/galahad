#!/bin/bash
# docker-firewall.sh — close only the Docker-published ports that are dangerous AND never
# needed from outside, WITHOUT ever locking the operator out of Coolify.
#
# WHY: there is no Hostinger cloud firewall and Docker's DNAT bypasses ufw (DOCKER-USER is
# where forwarded-to-container traffic is actually filtered). But the operator administers
# from many networks (Starlink / Camtel / Orange / VPN) with dynamic IPs, so an IP allowlist
# is the WRONG tool — it would lock him out on a new network. So:
#   • 8000 (Coolify dashboard) + 6001/6002 (realtime the dashboard needs) stay OPEN — reachable
#     from any network, gated by Coolify's own login. (Coolify has no HTTPS domain yet; the raw
#     port is the only way in. The durable upgrade is a coolify.<domain> FQDN + 2FA, then this
#     script can close 8000 too — see INTERNAL_ONLY below to extend it.)
#   • 8080 (Traefik API/dashboard — typically UNAUTHENTICATED, the real risk) and 8964 (an app
#     already served over 443 via its domain, so the raw port is redundant) → INTERNAL ONLY:
#     reachable from Docker networks, dropped from the internet. Neither is needed externally;
#     if ever, reach them over an SSH tunnel.
#   80/443 (all apps, via Traefik) and SSH/22 are untouched.
#
# ROBUSTNESS: matches the ORIGINAL destination port via conntrack (--ctorigdstport), NOT
# --dport. In DOCKER-USER the packet is already DNAT'd to the container IP:port, and those
# container IPs shuffle on every redeploy — matching the original published port is stable.
# Idempotent: deletes its own prior rules (incl. any legacy IP-allowlist rules) before
# re-adding, so it is safe to re-run and to re-apply after every Docker daemon restart.
set -uo pipefail
INTERNAL="10.0.0.0/8"
INTERNAL_ONLY="${INTERNAL_ONLY_PORTS:-8080 8964}"   # dangerous/redundant → internal only
OPEN_PORTS="${OPEN_PORTS:-8000 6001 6002}"          # operator-reachable from anywhere (auth-gated)
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
