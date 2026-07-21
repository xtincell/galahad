#!/usr/bin/env bash
# Ferme à Internet les ports du tunnel de fortune. Tout doit passer par le sas (:443).
# À exécuter sur le HOST (root). Vérifie/adapte selon ufw ou iptables.
set -euo pipefail

PORTS=(5533 8443 8787 8000)   # danmem-db, gateway audit, WebUI Hermes, Coolify API
# NB : 22 (SSH) — garde-le ouvert seulement depuis ton IP d'admin, ne le ferme pas à l'aveugle.

if command -v ufw >/dev/null; then
  for p in "${PORTS[@]}"; do
    echo "ufw deny $p/tcp"
    ufw deny "$p"/tcp || true
  done
  ufw reload
  echo "→ ufw : ports ${PORTS[*]} refusés. SSH (22) inchangé — restreins-le à ton IP séparément."
else
  echo "ufw absent. Équivalent iptables (adapter l'interface WAN) :"
  for p in "${PORTS[@]}"; do
    echo "  iptables -A INPUT -p tcp --dport $p -j DROP"
  done
  echo "Puis rendre les backends joignables UNIQUEMENT sur le réseau Docker interne (pas de port publié)."
fi

echo
echo "IMPORTANT (Coolify) : sur chaque service (danmem-db, gateway audit, WebUI, danmem-webdav),"
echo "retire le 'Ports Mappings' public. Ils doivent rester joignables seulement via le réseau 'coolify',"
echo "donc atteints exclusivement par la passerelle sas."
