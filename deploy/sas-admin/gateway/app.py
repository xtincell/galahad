"""
Sas Admin danhermes — passerelle d'accès unique pour l'agent admin (Fable).

Principe : Fable s'authentifie comme LUI-MÊME (JWT court TTL). La passerelle
détient les secrets des services et les injecte côté serveur. Fable atteint
TOUT (danmem, wiki, radar, cockpit, coolify, exec) via un seul point
authentifié, tracé et révocable — sans jamais détenir un secret backend.

Auth  : Authorization: Bearer <JWT Fable>  (HS256, exp, jti révocable)
Audit : append-only JSONL (qui / quand / méthode / route / statut)
"""
import os, json, time, base64, subprocess, shlex
import httpx, jwt
from fastapi import FastAPI, Request, Response, HTTPException

# ---- Config (tout vient de l'env — aucun secret en dur) ----
JWT_SECRET   = os.environ["SAS_JWT_SECRET"]
AUDIENCE     = os.environ.get("SAS_AUDIENCE", "danhermes-admin")
REVOKED_FILE = os.environ.get("SAS_REVOKED_FILE", "/data/revoked.json")
AUDIT_FILE   = os.environ.get("SAS_AUDIT_FILE", "/data/audit.jsonl")

# Table des services : prefix -> (url interne, mode d'injection, secret).
#   inject "bearer" : pose  Authorization: Bearer <secret>
#   inject "basic"  : pose  Authorization: Basic base64(user:pass)   (secret = (user, pass))
#   inject "none"   : ne pose rien (le backend gère son auth lui-même, ex. danmem-gateway)
SERVICES = {
    # danmem : le front nginx (danmem-gateway) injecte déjà le bearer DanMem -> rien à poser ici.
    "danmem":  {"url": os.environ.get("DANMEM_URL", "http://danmem-gateway:80"),
                "inject": "none", "secret": ""},
    # wiki : WebDAV, Basic Auth.
    "wiki":    {"url": os.environ.get("WEBDAV_URL", "http://webdav-gateway:80"),
                "inject": "basic",
                "secret": (os.environ.get("WEBDAV_USER", ""), os.environ.get("WEBDAV_PASS", ""))},
    # radar : API maison, Bearer <RADAR_TOKEN>.  ⚠️ hostname = nom de conteneur Coolify
    #         (pas d'alias stable) : à re-vérifier si radar est redéployé.
    "radar":   {"url": os.environ.get("RADAR_URL", ""),
                "inject": "bearer", "secret": os.environ.get("RADAR_TOKEN", "")},
    # cockpit : Basic Auth (BASIC_AUTH_USER / BASIC_AUTH_PASS de l'app cockpit).
    "cockpit": {"url": os.environ.get("COCKPIT_URL", "http://cockpit:3000"),
                "inject": "basic",
                "secret": (os.environ.get("COCKPIT_USER", ""), os.environ.get("COCKPIT_PASS", ""))},
    # coolify : API v1, Bearer <COOLIFY_TOKEN>.  Port interne = 8080 (nginx), pas 8000.
    "coolify": {"url": os.environ.get("COOLIFY_URL", "http://coolify:8080"),
                "inject": "bearer", "secret": os.environ.get("COOLIFY_TOKEN", "")},
}

# radar n'a pas d'alias réseau stable : son hostname est le nom de conteneur Coolify
# (avec un suffixe de déploiement qui change à chaque redeploy). On garde l'URL statique
# de .env pour le trafic normal, mais on sait la RE-RÉSOUDRE par le préfixe d'UUID Coolify
# (RADAR_CONTAINER_PREFIX — stable across redeploys) via la socket docker, en cas d'échec.
RADAR_PREFIX = os.environ.get("RADAR_CONTAINER_PREFIX", "")
RADAR_PORT   = os.environ.get("RADAR_PORT", "3000")
_radar_url   = {"cur": os.environ.get("RADAR_URL", "")}


def resolve_radar() -> str:
    """Re-résout l'URL radar par le préfixe d'UUID de conteneur. Met à jour le cache."""
    if not RADAR_PREFIX:
        return _radar_url["cur"]
    try:
        out = subprocess.run(["docker", "ps", "--filter", f"name={RADAR_PREFIX}",
                              "--format", "{{.Names}}"], capture_output=True, text=True, timeout=10)
        names = out.stdout.split()
        if names:
            _radar_url["cur"] = f"http://{names[0]}:{RADAR_PORT}"
    except Exception:
        pass
    return _radar_url["cur"]


# /exec : le conteneur ne dispose que du client `docker` (socket montée). Toute la
# maintenance host/DB passe par `docker exec <conteneur> ...` (ex. psql, systemctl du
# host via un conteneur privilégié, journaux via `docker logs`). L'allowlist porte
# sur argv[0]. NB : autoriser `docker` = pleins pouvoirs via la socket (assumé : Fable
# est l'agent admin, VPS = sandbox).
EXEC_ALLOW = set(filter(None, os.environ.get("SAS_EXEC_ALLOW", "docker").split(",")))

app = FastAPI(title="Sas Admin danhermes")
client = httpx.AsyncClient(timeout=120.0, follow_redirects=False)

# En-têtes hop-by-hop à NE PAS relayer : ils décrivent la connexion cliente, pas la
# requête. Relayer "transfer-encoding: chunked" tout en envoyant un body à taille fixe
# fait pendre les backends WebDAV (ReadTimeout sur PUT).
HOP_BY_HOP = {"host", "content-length", "connection", "keep-alive", "transfer-encoding",
              "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate"}


def _revoked() -> set:
    try:
        with open(REVOKED_FILE) as f:
            return set(json.load(f))
    except Exception:
        return set()


def audit(entry: dict):
    entry["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    os.makedirs(os.path.dirname(AUDIT_FILE), exist_ok=True)
    with open(AUDIT_FILE, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def authenticate(request: Request) -> str:
    """Vérifie le JWT de Fable. Renvoie le sujet (identité) ou lève 401/403."""
    h = request.headers.get("authorization", "")
    if not h.startswith("Bearer "):
        raise HTTPException(401, "missing bearer")
    token = h[7:]
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience=AUDIENCE)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, f"invalid token: {e}")
    if claims.get("jti") in _revoked():
        raise HTTPException(403, "token revoked")
    return claims.get("sub", "unknown")


def inject_auth(headers: dict, svc: dict):
    """Retire l'auth de Fable, pose le secret du service (côté serveur)."""
    headers.pop("authorization", None)
    headers.pop("Authorization", None)
    if svc["inject"] == "bearer" and svc["secret"]:
        headers["authorization"] = f"Bearer {svc['secret']}"
    elif svc["inject"] == "basic":
        u, p = svc["secret"]
        headers["authorization"] = "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()


@app.get("/health")
async def health():
    return {"ok": True, "services": list(SERVICES), "exec_allow": sorted(EXEC_ALLOW)}


@app.post("/exec")
async def exec_cmd(request: Request):
    sub = authenticate(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "corps JSON invalide (attendu: {\"argv\": [...]} ou {\"cmd\": \"...\"})")
    argv = body.get("argv") or shlex.split(body.get("cmd", ""))
    if not argv:
        raise HTTPException(400, "argv/cmd requis")
    if argv[0] not in EXEC_ALLOW:
        audit({"who": sub, "action": "exec", "argv": argv, "status": "DENIED"})
        raise HTTPException(403, f"commande non autorisée: {argv[0]} (autorisées: {sorted(EXEC_ALLOW)})")
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              timeout=body.get("timeout", 120))
    except FileNotFoundError:
        audit({"who": sub, "action": "exec", "argv": argv, "status": "ENOENT"})
        raise HTTPException(400, f"binaire absent du conteneur: {argv[0]}")
    except subprocess.TimeoutExpired:
        audit({"who": sub, "action": "exec", "argv": argv, "status": "TIMEOUT"})
        raise HTTPException(504, "exec: délai dépassé")
    audit({"who": sub, "action": "exec", "argv": argv, "status": proc.returncode})
    return {"code": proc.returncode, "stdout": proc.stdout[-20000:], "stderr": proc.stderr[-8000:]}


@app.api_route("/{svc}/{path:path}",
               methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD",
                        "OPTIONS", "PROPFIND", "PROPPATCH", "MKCOL", "MOVE", "COPY"])
async def proxy(svc: str, path: str, request: Request):
    sub = authenticate(request)
    service = SERVICES.get(svc)
    if not service:
        raise HTTPException(404, f"service inconnu: {svc}")
    base = _radar_url["cur"] if svc == "radar" else service["url"]
    if not base:
        raise HTTPException(503, f"service non configuré: {svc} (URL vide dans .env)")
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in HOP_BY_HOP}
    inject_auth(headers, service)
    body = await request.body()

    async def _send(b):
        return await client.request(request.method, b.rstrip("/") + "/" + path,
                                    headers=headers, content=body, params=request.query_params)

    try:
        up = await _send(base)
    except httpx.RequestError as e:
        # radar : le conteneur a peut-être été redéployé -> re-résoudre et réessayer une fois.
        if svc == "radar" and RADAR_PREFIX:
            newbase = resolve_radar()
            if newbase and newbase != base:
                try:
                    up = await _send(newbase)
                    audit({"who": sub, "action": "proxy", "svc": svc, "method": request.method,
                           "path": "/" + path, "status": up.status_code, "reresolved": True})
                    resp_headers = {k: v for k, v in up.headers.items()
                                    if k.lower() not in ("content-encoding", "transfer-encoding", "connection")}
                    return Response(content=up.content, status_code=up.status_code, headers=resp_headers)
                except httpx.RequestError as e2:
                    e = e2
        audit({"who": sub, "action": "proxy", "svc": svc, "method": request.method,
               "path": "/" + path, "status": "UPSTREAM_ERR", "err": type(e).__name__})
        raise HTTPException(502, f"backend '{svc}' injoignable: {type(e).__name__}")
    audit({"who": sub, "action": "proxy", "svc": svc, "method": request.method,
           "path": "/" + path, "status": up.status_code})
    resp_headers = {k: v for k, v in up.headers.items()
                    if k.lower() not in ("content-encoding", "transfer-encoding", "connection")}
    return Response(content=up.content, status_code=up.status_code, headers=resp_headers)
