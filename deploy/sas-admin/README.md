# 🛡️ Sas Admin danhermes

Passerelle d'accès **unique, authentifiée et tracée** pour l'agent admin (Fable).
Fable atteint tout le stack proprement : il s'authentifie comme lui-même, la
passerelle détient les secrets et les injecte côté serveur, chaque appel est loggé,
le token est révocable en une commande.

## Le modèle en une image

```
Fable  ──Bearer JWT(Fable)──►  admin.danhermes.<host>  (Traefik :443)
                                        │
                                   sas-gateway  ── vérifie le JWT (exp, jti)
                                        │        ── log audit (qui/quoi/quand)
                                        │        ── RETIRE l'auth de Fable
                                        │        ── INJECTE le secret du service
                                        ▼
        danmem · wiki(WebDAV) · radar · cockpit · coolify · /exec(docker)
```

- **Fable ne détient jamais** un token danmem/Coolify ni un mot de passe WebDAV.
  Il ne porte que **son** JWT court. Une fuite de son token n'expose aucun secret backend.
- **Un seul point exposé** (:443, authentifié). Les ports directs (5533/8443/8787/8000)
  sont fermés par UFW.

## Table de routage (état réel, vérifié 2026-07-21)

| Préfixe Fable      | Backend interne (réseau `coolify`)          | Auth injectée par le sas          |
|--------------------|---------------------------------------------|-----------------------------------|
| `/danmem/*`        | `http://danmem-gateway:80`                  | aucune — nginx injecte le bearer  |
| `/wiki/*`          | `http://webdav-gateway:80` (racine = `/data`) | Basic (`WEBDAV_USER/PASS`)      |
| `/radar/*`         | `http://<conteneur-radar>:3000`             | Bearer (`RADAR_TOKEN`)            |
| `/cockpit/*`       | `http://cockpit:3000`                       | Basic (`COCKPIT_USER/PASS`)      |
| `/coolify/*`       | `http://coolify:8080`                       | Bearer (`COOLIFY_TOKEN`)         |
| `POST /exec`       | binaire local `docker` (socket montée)      | —                                 |

⚠️ **wiki** : le WebDAV sert `/data`, et le wiki vit dans `/data/wiki/`. Le chemin Fable
est donc **`/wiki/wiki/<fichier>`** (1er `wiki` = préfixe service, 2e = dossier).
Ex. : `GET /wiki/wiki/Bilan_Aout_2026.md`.

⚠️ **radar** : le hostname est le **nom de conteneur Coolify** (pas d'alias réseau stable).
Si radar est redéployé, mettre à jour `RADAR_URL` (`docker ps | grep radar`).

## Installation (sur le host Coolify)

```bash
cd /opt/sas-admin
./install.sh                 # 1er run : crée .env + génère la clé JWT (openssl rand -hex 32)
#   → remplir .env (voir .env.example : URLs backend + secrets)
./install.sh                 # 2e run : build + up + émet un token Fable
```

## Utilisation (côté Fable) — en-tête sur **tous** les appels : `Authorization: Bearer <JWT>`

```
GET      .../health                         (public, liste les services)
GET      .../danmem/peers
GET      .../wiki/wiki/Plan_Aout_2026.md
PUT      .../wiki/wiki/Plan_Aout_2026.md    (WebDAV : lecture ET écriture)
PROPFIND .../wiki/                          (Depth: 1 pour lister)
GET      .../coolify/api/v1/version
GET      .../radar/... · .../cockpit/...
POST     .../exec                           {"argv": ["docker","ps"]}
```

## `/exec` — accès médié par `docker`

Le conteneur ne dispose que du **client `docker`** (socket Docker montée). L'allowlist
`SAS_EXEC_ALLOW` (défaut : `docker`) porte sur `argv[0]`. Toute la maintenance host/DB
passe par `docker exec` :

```
{"argv": ["docker","ps"]}
{"argv": ["docker","logs","--tail","50","<conteneur>"]}
{"argv": ["docker","exec","<conteneur-postgres>","psql","-U","...","-c","..."]}   # maintenance DB
{"argv": ["docker","restart","<conteneur>"]}
```

Réponses : `{"code": <rc>, "stdout": "...", "stderr": "..."}`. JSON malformé → 400,
commande hors allowlist → 403, binaire absent → 400, timeout → 504.

## Gérer les tokens

```bash
# émettre (12h) — le secret vient de .env
export $(grep -E '^SAS_(JWT_SECRET|AUDIENCE)=' .env | xargs)
python3 scripts/issue-fable-token.py --sub fable --hours 12

# révoquer immédiatement (coupe-circuit) par jti
docker compose exec sas-gateway python3 - <<'PY'
import os,json; p="/data/revoked.json"
d=set(json.load(open(p))) if os.path.exists(p) else set()
d.add("<jti-a-revoquer>"); json.dump(sorted(d),open(p,"w")); print("ok")
PY
```

## Audit

Journal append-only dans le volume `sas-data` : `/data/audit.jsonl`
```bash
docker compose exec sas-gateway tail -f /data/audit.jsonl
```
Chaque ligne : `ts, who, action(proxy|exec), svc/method/path ou argv, status`.
Un backend injoignable est tracé `UPSTREAM_ERR` et renvoyé en 502 (pas de 500 opaque).

## Nuance mémoire

Le **contenu** mémoire passe par l'API danmem S7-safe (`/danmem/...`, qui exclut déjà S7).
Le **raw-DB** (`/exec` → `docker exec <pg> psql`) se réserve à la **maintenance**
(migrations, backups), jamais pour verser du S7 dans le contexte de l'agent.

## Fichiers

```
sas-admin/
├─ docker-compose.yml       label Traefik + service passerelle (réseau coolify externe)
├─ .env.example             câblage backend + secrets (jamais chez Fable ; chmod 600)
├─ install.sh               installateur idempotent
├─ gateway/
│   ├─ app.py               passerelle : auth JWT + injection + proxy + audit + /exec
│   ├─ requirements.txt
│   └─ Dockerfile           python:3.12-slim + client docker (multi-stage) + healthcheck
└─ scripts/
    ├─ issue-fable-token.py émission JWT
    ├─ revoke-token.py      révocation par jti
    └─ close-ports.sh       ferme 5533/8443/8787/8000 à Internet
```

## Correctifs 2026-07-21 (audit & nettoyage)

- **URLs backend** recâblées (hostnames introuvables `danmem`/`danmem-webdav`/`radar`,
  port coolify `8000`→`8080`) ; `RADAR_TOKEN` renseigné ; `cockpit` passé en Basic Auth.
- **app.py** : gestion d'erreur upstream (502 propre + audit au lieu de 500), garde
  JSON `/exec` (400), filtrage des en-têtes **hop-by-hop** (`transfer-encoding`…) qui
  faisaient pendre les PUT WebDAV.
- **`/exec`** : le client `docker` est réellement présent (Dockerfile multi-stage) ;
  allowlist ramenée à `docker` (les binaires host annoncés n'existaient pas dans le conteneur).
- **`SAS_JWT_SECRET`** renouvelé en clé forte 64-hex.
- **Backend WebDAV** (composant voisin, `/opt/data/webdav/server.py`) : `wsgiref` ne
  bornait pas `wsgi.input` à `Content-Length` → PUT bloqué. Corrigé (input borné + serveur
  threadé). Backups : `server.py.running.bak`, `server.py.hostcopy.bak`.
