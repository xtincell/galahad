#!/bin/bash
# docker-firewall.sh — close the Coolify admin surface that Docker published to the world.
#
# WHY THIS EXISTS: there is no Hostinger cloud firewall, and Docker's DNAT bypasses ufw
# (the DOCKER-USER chain is where forwarded-to-container traffic is actually filtered).
# Coolify published its dashboard (8000), realtime (6001/6002), Traefik API (8080) and one
# app's raw port (8964) on 0.0.0.0 — reachable by anyone. This restricts them to Alexandre's
# ISP block + internal Docker networks and drops the rest. 80/443 stay fully public (that's
# where the apps live, via Traefik) and SSH/22 is a host-INPUT port, untouched.
#
# ROBUSTNESS: matches the ORIGINAL destination port via conntrack (--ctorigdstport), NOT
# --dport. In DOCKER-USER the packet is already DNAT'd to the container IP:port, and those
# container IPs shuffle on every redeploy — matching the original published port is stable.
# Idempotent: deletes its own prior rules before re-adding, so it is safe to re-run and to
# re-apply after every Docker daemon restart (which flushes DOCKER-USER).
set -uo pipefail
ADMIN="${ADMIN_CIDR:-143.105.152.0/24}"   # Alexandre's ISP block (IPs seen: .56, .141 — dynamic)
INTERNAL="10.0.0.0/8"
PORTS="${ADMIN_PORTS:-8000 6001 6002 8080 8964}"
CH=DOCKER-USER

command -v iptables >/dev/null || { echo "no iptables"; exit 1; }

add() { iptables -C "$CH" "$@" 2>/dev/null || iptables -I "$CH" "$@"; }
del_all() { while iptables -D "$CH" "$@" 2>/dev/null; do :; done; }

for p in $PORTS; do
  m="-p tcp -m conntrack --ctorigdstport $p"
  # remove any prior copies (idempotency)
  del_all $m -s "$ADMIN" -j RETURN
  del_all $m -s "$INTERNAL" -j RETURN
  del_all $m -j DROP
  # re-insert: RETURNs must sit ABOVE the DROP (iptables -I prepends, so add DROP first)
  iptables -I "$CH" $m -j DROP
  iptables -I "$CH" $m -s "$INTERNAL" -j RETURN
  iptables -I "$CH" $m -s "$ADMIN" -j RETURN
done
logger -t docker-firewall "applied: admin=$ADMIN ports=[$PORTS] (80/443 public, ssh untouched)"
echo "docker-firewall applied — admin=$ADMIN, restricted ports: $PORTS"
