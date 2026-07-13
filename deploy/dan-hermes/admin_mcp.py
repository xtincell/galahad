#!/usr/bin/env python3
# Serveur MCP stdio — donne a Dan (Hermes) l'outil « admin_bash » : POUVOIR ADMIN ABSOLU.
# Hermes le lance en stdio ; sur appel, il POST a l'admin-bridge (hote, root), qui execute
# la commande bash en ROOT sur le VPS et renvoie stdout/stderr. Garde-fous cote pont.
# URL + token via l'environnement. IMPORTANT (bug connu Hermes) : la config MCP doit pointer
# le CHEMIN ABSOLU de ce fichier (Hermes spawn les serveurs MCP sans HOME -> expanduser echoue).
import sys, json, os, urllib.request

URL = os.environ.get("ADMIN_BRIDGE_URL", "http://10.0.2.1:8798")
TOKEN = os.environ.get("ADMIN_BRIDGE_TOKEN", "")

TOOL = {
    "name": "admin_bash",
    "description": ("POUVOIR ADMIN ABSOLU : execute une commande bash en ROOT sur le VPS hote. "
                    "C'est ton levier de chef d'orchestre : docker (ps/logs/restart/exec), Coolify "
                    "(curl http://localhost:8000/api/v1/... avec le token), systemctl (restart des "
                    "agents hulysse/talos/services), fichiers, reseau, cron. Utilise-le pour PILOTER "
                    "et COORDONNER (pas pour coder toi-meme : le dur va a convoque_claude). "
                    "Les commandes catastrophiques irreversibles (rm -rf /, mkfs, shutdown...) sont "
                    "refusees par le garde-fou. Tout est journalise (audit)."),
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "La commande bash a executer en root sur le VPS."},
        },
        "required": ["command"],
    },
}


DELEGATE_TOOL = {
    "name": "delegate",
    "description": ("DELEGUE une SKILL a un directeur operationnel (Talos = infra/QA, Hulysse = "
                    "veille/dev) et recois son VERDICT structure. C'est ta primitive de "
                    "coordination : au lieu de tout piloter toi-meme a la main via admin_bash, tu "
                    "confies une procedure verifiee au bon directeur, qui l'execute sur son moteur "
                    "et te rend le resultat. Le directeur tire le job de la file danmem (aucun port "
                    "entrant), l'execute via son runtime de skills (preconditions -> etapes -> "
                    "verification), et ecrit le resultat. Skills connues : 'diagnostic-coolify' "
                    "(sante de la stack Coolify), 'audit-coherence' (audit declare-vs-reel : cron, "
                    "derive repo/deploye, modeles figes). Reponse en < 2 min."),
    "inputSchema": {
        "type": "object",
        "properties": {
            "to_agent": {"type": "string", "description": "Le directeur : 'Talos' ou 'Hulysse'."},
            "skill": {"type": "string", "description": "Nom de la skill (ex: diagnostic-coolify, audit-coherence)."},
            "args": {"type": "object", "description": "Arguments optionnels substitues dans la skill."},
        },
        "required": ["to_agent", "skill"],
    },
}


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def call_delegate(to_agent, skill, args):
    # Reuse the host-side delegate.sh (POST to danmem bus + poll) via the admin bridge —
    # no danmem token needs to live inside Hermes. Returns the director's finding.
    import shlex
    argj = json.dumps(args or {})
    cmd = "/opt/galahad/bin/delegate.sh {} {} {}".format(
        shlex.quote(to_agent), shlex.quote(skill), shlex.quote(argj))
    return call_bridge(cmd)


def call_bridge(command):
    payload = {"token": TOKEN, "command": command}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=310) as r:
        d = json.load(r)
    if "stdout" in d or "stderr" in d:
        out = d.get("stdout", "")
        err = d.get("stderr", "")
        tail = f"\n[exit={d.get('exit')}]" + (f"\n[stderr] {err}" if err else "")
        return (out + tail).strip() or "(aucune sortie)"
    return "ERREUR pont admin: " + str(d.get("error"))


# Boucle stdio par-ligne (readline = non bloquant, repond des qu'une ligne complete arrive).
while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except Exception:
        continue
    mid = msg.get("id")
    method = msg.get("method")
    if method == "initialize":
        pv = (msg.get("params") or {}).get("protocolVersion") or "2024-11-05"
        send({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": pv, "capabilities": {"tools": {}},
            "serverInfo": {"name": "admin-bridge", "version": "1.0.0"}}})
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [TOOL, DELEGATE_TOOL]}})
    elif method == "tools/call":
        params = msg.get("params") or {}
        tname = params.get("name")
        args = params.get("arguments") or {}
        try:
            if tname == "delegate":
                out = call_delegate(args.get("to_agent", ""), args.get("skill", ""), args.get("args") or {})
            else:
                out = call_bridge(args.get("command", ""))
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": (out or "")[:40000]}], "isError": False}})
        except Exception as e:
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": "ERREUR " + str(tname) + ": " + str(e)}], "isError": True}})
    elif method == "ping":
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif mid is not None:
        send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}})
