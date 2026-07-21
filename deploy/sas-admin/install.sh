#!/usr/bin/env bash
# Sas Admin danhermes — installateur. À lancer sur le HOST (là où tourne Coolify/Traefik).
set -euo pipefail
cd "$(dirname "$0")"

echo "== Sas Admin danhermes =="

# 1) .env
if [ ! -f .env ]; then
  cp .env.example .env
  # génère la clé de signature si absente
  if grep -q "CHANGE_ME" .env; then
    KEY=$(openssl rand -hex 32)
    sed -i "s/^SAS_JWT_SECRET=.*/SAS_JWT_SECRET=$KEY/" .env
    echo "→ SAS_JWT_SECRET généré."
  fi
  chmod 600 .env
  echo "→ .env créé. REMPLIS les secrets backends (DANMEM_TOKEN, WEBDAV_*, COOLIFY_TOKEN...) puis relance."
  exit 0
fi

# 2) réseau Traefik (adapter si le nom diffère)
NET="${TRAEFIK_NET:-coolify}"
docker network inspect "$NET" >/dev/null 2>&1 || { echo "réseau '$NET' introuvable — édite docker-compose.yml"; exit 1; }

# 3) build + up
docker compose up -d --build
echo "→ passerelle up."

# 4) santé
sleep 3
docker compose exec -T sas-gateway curl -fsS http://localhost:8080/health && echo || echo "health KO — voir logs"

# 5) émettre un token Fable
export $(grep -E '^SAS_(JWT_SECRET|AUDIENCE)=' .env | xargs)
echo
echo "== Token Fable (12h) =="
python3 scripts/issue-fable-token.py --sub fable --hours 12
echo
echo "Fable appelle :  https://admin.danhermes.76-13-128-23.sslip.io/<service>/<path>"
echo "  en-tête       :  Authorization: Bearer <token ci-dessus>"
echo "  services      :  danmem  wiki  radar  cockpit  coolify   + POST /exec"
echo
echo "Puis, pour refermer le tunnel de fortune :  sudo ./scripts/close-ports.sh"
