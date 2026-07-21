# Galahad — Leçons de terrain (runbook anti-blocage)

> À lire AVANT de redéployer Galahad ailleurs. Chaque entrée = **symptôme observable → cause racine → fix**.
> Objectif : traverser sans se stuck sur ce qui nous a coûté des heures. Format tenu par le skill `capitaliser`.

---

## 1. Coolify (déploiement d'apps)

### 1.1 Changer le domaine (fqdn) ne régénère PAS le HTTPS
- **Symptôme** : tu changes le `fqdn` d'une app, tu redéploies, mais les labels Traefik restent en `http` / pas de router https. Le domaine répond en 404/redirige mal.
- **Cause** : le champ `custom_labels` est **figé** en base — Coolify ne régénère pas les labels tant qu'il est rempli.
- **Fix** : `custom_labels = null` sur l'app (via `docker exec coolify php artisan tinker`), PUIS redéployer (`GET /api/v1/deploy?uuid=…&force=true`). Les labels se régénèrent depuis le fqdn.

### 1.2 Les apps Docker Compose IGNORENT le champ `fqdn`
- **Symptôme** : app de type compose (ex. un jeu) — tu mets un domaine dans `fqdn`, le router généré garde l'ancien host (sslip) quoi que tu fasses.
- **Cause** : pour une app compose, Coolify génère les labels **par service-compose**, pas depuis `fqdn`.
- **Fix** : ne pas se battre avec les labels → router le domaine via un **file-provider Traefik** (cf. §2.1), pointant sur le conteneur par son **alias réseau stable** (nom du service compose).

### 1.3 Queue de déploiement bloquée → 503 en série
- **Symptôme** : plusieurs apps répondent **503** (« no available server »), leurs conteneurs sont vieux (pas recréés) alors que tu as lancé des redeploys.
- **Cause** : lancer plusieurs redeploys quasi-simultanés peut laisser un job en `in_progress` **hung** qui bloque toute la file.
- **Fix** : `DB::table("application_deployment_queues")->whereIn("status",["in_progress","queued"])->update(["status"=>"failed"])` puis redéployer **séquentiellement**.

### 1.4 Redéployer ne casse jamais l'existant
- **Fait rassurant** : Coolify ne **remplace le conteneur qu'en cas de build réussi**. Un redeploy qui échoue laisse tourner l'ancien conteneur. Donc : redéployer pour régénérer des labels est **sans risque** pour ce qui tourne déjà.

### 1.5 POST d'une variable d'env → 422
- **Symptôme** : `POST /applications/{uuid}/envs` renvoie 422.
- **Cause** : les champs `is_build_time` / `is_preview` ne sont pas acceptés.
- **Fix** : payload **minimal** `{key, value}` uniquement.

### 1.6 fqdn à schémas mixtes → domaine « mangé » à la génération
- **Symptôme** : un fqdn `http://sslip,https://custom` → un des domaines disparaît des labels (router omis), non déterministe.
- **Fix** : préférer **tout-https** ; si le sslip uuid n'est plus voulu, le **drop** carrément.

---

## 2. Traefik / TLS / Domaines

### 2.1 File-provider Traefik (le couteau suisse, zéro rebuild)
- **Usage** : router un domaine vers un conteneur maison OU une app compose, sans toucher aux labels.
- **Fix** : le proxy `coolify-proxy` a `--providers.file.directory=/traefik/dynamic/ --providers.file.watch=true`, monté depuis l'hôte `/data/coolify/proxy/dynamic/`. Déposer un `.yml` : routers (http→redirect https + https avec `tls.certResolver: letsencrypt`) + services `loadBalancer.servers.url: http://<nom-conteneur-ou-alias>:<port>`. Hot-reload immédiat. Référencer par **alias réseau STABLE** (nom de service compose / nom de conteneur maison) — **pas par l'uuid** (Coolify n'alias PAS par uuid). Réseau `coolify` partagé requis.

### 2.2 Nouveau gTLD (.com/.online) — l'@ pointe sur l'IP de parking
- **Symptôme** : après enregistrement, `@` A record pointe sur l'IP de parking du registrar (double A record après un `overwrite=false`).
- **Fix** : DNS `@` A record avec **`overwrite=true`** vers l'IP du VPS + un wildcard `*` A. Prévenir du délai de propagation.

### 2.3 Hairpin NAT
- HTTP + HTTPS **valides** (listeners TLS OK) sont joignables depuis le VPS lui-même. Un cert letsencrypt en cours de provisioning → `curl` code `000` (cert pas prêt) ou `-60` (SSL) → attendre / retester.

### 2.4 Ponts internes (claude-bridge, admin-bridge) : ufw est PAR PORT
- **Symptôme** : un agent (Dan) ne joint pas un nouveau pont HTTP interne (`/health` INJOIGNABLE) alors que le pont écoute bien (`0.0.0.0:<port>`) ET qu'un autre pont sur un port voisin marche.
- **Cause** : ufw a des règles **par port**. `allow from 10.0.0.0/8 to any port 8799` existe (claude-bridge) mais PAS pour le nouveau port.
- **Fix** : `ufw allow from 10.0.0.0/8 to any port <PORT> proto tcp` puis `ufw reload`. Les ponts bindent `0.0.0.0` mais restent privés grâce au `default deny incoming` (public bloqué) + cet allow ciblé sur les réseaux docker. Depuis un conteneur, viser la **passerelle de SON réseau** (ex. `10.0.2.1:<port>`), pas seulement `10.0.0.1`.

---

## 3. Agents & MCP (le plus vicieux)

### 3.1 Un serveur MCP « registered 0 tool / Connection closed » alors que le script marche à la main
- **Symptôme** : log de l'agent `MCP server '<x>' … Connection closed`, `registered 0 tool(s) (1 failed)`. Mais lancé à la main, le serveur MCP répond au handshake.
- **Fausse piste** : on croit à un bug du protocole ou du buffering. (Le buffering `for line in sys.stdin` EST un vrai souci — passe à `readline()` — mais ce n'était pas LA cause ici.)
- **Cause racine** : l'agent (Hermes) **spawn les serveurs MCP sans `HOME`** dans l'env. Si la commande fait `runpy.run_path(os.path.expanduser('~/…'))`, `expanduser('~')` ne résout pas → fichier introuvable → le process meurt → « Connection closed ».
- **Fix** : mettre le **chemin ABSOLU** dans la config MCP (`args: [/home/user/.../serveur.py]`), zéro dépendance à HOME. Reproduire le bug avec le SDK `mcp` client + un env sans HOME confirme en 30s.

### 3.2 `claude -p` headless échoue « no stdin data received in 3s »
- **Symptôme** : appel du binaire `claude -p "<prompt>"` via un service → exit non-zéro, stderr « Warning: no stdin data received in 3s, proceeding without it ».
- **Cause** : claude-code (≥ 2.1.201) attend du stdin puis échoue si le pipe reste **ouvert et vide**.
- **Fix** : fermer stdin tout de suite. En Node : `const c = execFile('claude', args, cb); c.stdin.end()`. En shell : `claude -p … < /dev/null`.

### 3.3 Auth Claude d'un user « service » qui tombe après un auto-update
- **Symptôme** : `claude auth status` → `loggedIn:false`, `claude -p` → « Not logged in ». Ça marchait la veille.
- **Cause** : un **auto-update de claude-code** ou une rotation de token OAuth invalide une session copiée (claude.ai session courte). Un **setup-token** (`oauth_token`) est bien plus durable.
- **Fix** : re-copier les credentials d'un compte valide (`/root/.claude/.credentials.json` → celui du user service) + **auto-heal** : un cron qui resync l'auth du user service depuis la source de vérité si elle est loggedIn.

### 3.4 « fetch drops Authorization on cross-origin redirect »
- **Symptôme** : un client qui tape une API en http suit une redirection vers https et perd l'en-tête `Authorization` → 401 inattendu.
- **Fix** : taper directement l'URL **https** finale (jamais l'http qui redirige) quand un bearer token est en jeu.

### 3.5 Agents homebrew (Ollama) — changer le cerveau à chaud
- Le modèle vit dans `dataDir/cerveau.txt` (ce que fait la commande `/cerveau`) avec fallback sur `<AGENT>_MODEL` (env). Écrire `cerveau.txt` + le fallback env + `systemctl restart` = bascule immédiate. Vérifier l'ID exact du modèle chez le provider AVANT (`GET https://ollama.com/v1/models`) — ex. `glm-5.2` est un modèle « thinking » : un `max_tokens` trop bas coupe pendant le raisonnement → réponse vide (pas une panne).
- ⚠️ **Piège post-re-platforming (2026-07-10)** : le moteur générique (`/opt/<agent>/src/brain.js`) tenait le modèle **en mémoire seulement** (`GALAHAD_MODEL` au boot + `/brain` volatile) — il ne lisait PLUS `cerveau.txt`. **Symptôme** : changer le cerveau depuis le cockpit ne fait rien ; `dan-brain list`/le statut affichent pourtant le nouveau modèle (ils lisent le fichier, pas le runtime). **Fausse piste** : croire que c'est le cockpit/le cron `brain-apply.sh` qui est cassé — la chaîne cockpit → `agent-brains.json` → `dan-brain set` → `cerveau.txt` marchait ; c'est le dernier maillon (moteur) qui n'écoutait plus. **Fix** : `brain.js` — `getModel()` relit `dataDir/cerveau.txt` sur changement de mtime (hot), `setModel()` (commande `/brain`) l'écrit aussi ; `chat()` appelle `getModel()` et plus la variable. **Signature** : affichage (fichier) ≠ comportement (runtime) = cousin du piège self-report SOUL.md — après tout refactor du moteur, re-tester la chaîne cockpit→runtime de bout en bout, pas seulement le fichier. **Portée** : tout redéploiement Galahad.

### 3.6 Fallback OpenRouter → 402 « requires more credits » alors qu'il reste du crédit
- **Symptôme** : `brain HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens…` sur le fallback OpenRouter, alors que le solde n'est pas nul. **Cause racine** : sans `max_tokens` explicite, OpenRouter **réserve la fenêtre de sortie max du modèle** (65k) et refuse si le solde ne la couvre pas — ce n'est pas la consommation réelle qui bloque, c'est la réservation. **Fix** : passer `max_tokens: 8192` (ou moins) sur l'appel fallback. **Signature** : 402 mentionnant un `max_tokens` énorme jamais demandé explicitement. **Portée** : générale (tout client OpenRouter à petit solde).
- Contexte fréquent : le fallback ne se déclenche massivement que quand le primaire (Ollama Cloud) est en **429 quota hebdo** — les deux pannes se cumulent et les agents semblent morts « quel que soit le modèle ».

### 3.7 Isolation des agents homebrew
- Hook `preToolUse` : `isInsideHome()` limite write/edit au home ; `OTHERS_PERIMETER` (regex) bloque toute action mutante sur le domaine d'un autre agent ; bash bloque `curl|wget|scp|rsync|ssh|mail|nc|ftp`. Pour ouvrir un agent à un **workspace partagé**, ajouter le chemin à `isInsideHome` + pointer `<AGENT>_WORKSPACE` dessus + ACL POSIX (`setfacl -R -m u:<agent>:rwx` + default). `git` n'est PAS dans la blocklist → push https OK.

### 3.8 Agent Claude autonome par cron (Fable) — les 4 pièges du headless
- **Contexte** : FABLE = agent de pilotage infra en `claude -p` headless réveillé par cron (deploy/fable/). Pattern réutilisable pour tout agent Claude autonome.
- **Piège 1 — `bypassPermissions` désarme TOUT** : en headless on lance `--permission-mode bypassPermissions` (sinon blocage interactif). Conséquence : **le hook PreToolUse est l’UNIQUE garde-fou**. Porter la logique guard du moteur homebrew (regex destructif/payant + consentement fenêtré file-backed + journal) en hook Claude Code (`.claude/hooks/guard.py`, exit 2 = bloqué). Vérifié live : le modèle est bloqué et n’insiste pas.
- **Piège 2 — forme argv** : les commandes destructives passent aussi en JSON argv via le sas (`{"argv":["docker","rm",...]}`) — normaliser (virer quotes/virgules) avant de matcher les regex, sinon le hook rate la moitié des cas.
- **Piège 3 — cron en user, pas root** : un run root laisse `journal.jsonl` root-owned → les runs claudebridge suivants échouent en `PermissionError` silencieuse. Le wrapper cron fait `sudo -u claudebridge`, et tout fichier partagé doit être owner claudebridge.
- **Piège 4 — auth headless** : réutiliser l’auth existante d’un user service (claudebridge) au lieu d’un OAuth dédié ; elle peut tomber après un auto-update (§3.3) → le wrapper cron resynchronise root→user avant chaque patrouille. Et toujours `claude -p ... < /dev/null` (§3.2).
- **Silence si rien** : le prompt de patrouille impose une dernière ligne exactement `RAS` — c’est le signal machine-lisible du wrapper (statut RAS/ACTION/ERROR journalisé ; ERROR s’auto-escalade).

---

## 4. Divers

### 4.1 Prisma 7 — `db push` « datasource.url required »
- **Fix** : créer `prisma.config.mjs` avec `{ schema: "schema.prisma", datasource: { url: process.env.DATABASE_URL } }` ; `prisma@7.8.0` ; driverAdapters `@prisma/adapter-pg`.

### 4.2 Migrer une routine Claude qui écrivait sur Supabase → Postgres self-hosted
- La routine utilisait le MCP Supabase `execute_sql`. Le remplacer par un helper `radar-sql` sur le VPS (trouve la base + `docker exec <pg> psql`), appelé en SSH via stdin heredoc. Le SQL reste identique (Postgres→Postgres). Les tables annexes (`routine_state`, `routine_runs`) se recréent via `create table if not exists`.

---

## Principe transversal
**Lire l'état RÉEL avant de croire la mémoire / la doc.** Plusieurs fois, la mémoire disait « OPÉRATIONNEL » alors que c'était cassé (ex. §3.1). Toujours : `list`/`get`/`docker inspect`/`curl` d'abord, agir ensuite.
