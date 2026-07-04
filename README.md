<div align="center">

# ✦ Galahad

**A self-hosted team of autonomous AI agents — on one server, driven from Telegram, agnostic to any LLM provider.**

[Quickstart](#quickstart) · [Architecture](docs/ARCHITECTURE.md) · [Pricing](#pricing) · [FR](#-galahad-en-français)

`self-hosted` · `provider-agnostic` · `zero build` · `zero inbound port` · `MIT`

</div>

---

## What Galahad is

Galahad runs a small **team of coordinated LLM agents** on a single VPS. One
engine image; each container is the same code wearing a different **role**:

- **🎩 Chef** — the orchestrator. Human-facing coordinator; routes work and delegates the heavy lifting.
- **🛡️ Guardian** — health patrol + code QA. Cheap and reactive: a routine patrol is a pure shell check (zero tokens), the brain wakes only on an anomaly.
- **🛰️ Traveler** — autonomous explorer + night-shift builder. Pursues goals, surveys the box, asks before it ships.
- **🧠 Claude bridge** *(optional)* — summonable Claude for real coding, gated behind the same guardrail as any paid action.

You talk to them on **Telegram**. They run **on your machine**. Their brain is
**any OpenAI-compatible endpoint** — Ollama Cloud, a local Ollama, OpenAI,
OpenRouter, Together, Groq. Swap providers in `.env`; swap a model live with
`/brain <model>`.

## What Galahad is *not*

Honesty is a feature. Galahad is **not** a managed SaaS, not a no-code studio,
not an AGI. It's a small, legible framework (~500 lines of dependency-free Node)
you host yourself. It does one thing well: **give you a reliable, cheap,
self-owned agent team you fully control.**

## Why it exists

Most "AI agent" products are someone else's cloud holding your keys, your code,
and your data — metered, opaque, and one pricing change from breaking your
budget. Galahad flips that:

| | Typical agent SaaS | **Galahad** |
|---|---|---|
| **Hosting** | Their cloud | **Your VPS** |
| **Your data** | Leaves the building | **Stays home** |
| **LLM provider** | Locked | **Any OpenAI-compatible endpoint** |
| **Cost at idle** | Per-seat / per-call | **~zero** (shell patrol, cheap models) |
| **Safety** | Trust the prompt | **Guardrails enforced in code** |
| **Auditability** | Black box | **Plain JSONL journals + markdown memory** |

## Key features

- **Provider-agnostic brain.** Point `LLM_BASE_URL` anywhere OpenAI-compatible. No vendor lock-in.
- **Role-configurable.** Three built-in roles; add your own by dropping a markdown persona in `engine/roles/`.
- **Cheap by design.** Routine patrol costs zero tokens; strong models only on demand; Claude only for peaks.
- **Programmatic guardrails.** Destructive or paid actions are refused unless you gave an explicit "yes" in the last 5 minutes — enforced in `hooks.js`, not by prompt politeness.
- **File-based memory.** Markdown cards + an index injected at wake-up. Continuity survives restarts; everything is greppable.
- **No inbound ports.** Agents reach out over Telegram long-polling. Nothing to expose.
- **One command to run.** `./install.sh` — Docker + Compose and you're live.

## Quickstart

```bash
git clone https://github.com/xtincell/galahad.git
cd galahad
./install.sh          # prompts for bot tokens, chat id, LLM endpoint & key
```

Or manually:

```bash
cp .env.example .env  # fill in your values
docker compose up -d               # the three agents
docker compose --profile bridge up -d   # + the optional Claude bridge
```

Then message any bot on Telegram and send `/help`.

**You'll need:** a Linux VPS with Docker, three Telegram bots (one per agent, via
[@BotFather](https://t.me/BotFather)), and an API key for any OpenAI-compatible
LLM endpoint. The Claude bridge additionally needs an Anthropic key.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for how the pieces fit, and
**[cockpit/](cockpit/index.html)** for the dashboard.

## Configuration

Everything is environment-driven — no operator secret is ever baked into an
image. Full reference in [`.env.example`](.env.example). The essentials:

| Variable | Meaning |
|---|---|
| `OPERATOR_CHAT_ID` | The single Telegram chat the agents will talk to |
| `*_TELEGRAM_BOT_TOKEN` | One bot per agent |
| `LLM_BASE_URL` / `LLM_API_KEY` | Your OpenAI-compatible brain |
| `*_MODEL` | Per-role model id |
| `WORKSPACE_HOST` | Host path the team surveys & builds in |
| `CLAUDE_BRIDGE_TOKEN` / `ANTHROPIC_API_KEY` | Enable the optional bridge |

## Pricing

Galahad the framework is **free and open source (MIT)**. Around it, three tiers:

### 🟢 Self-hosted — **Free**
The full framework. Clone, run on your own VPS, own everything. Community support
via GitHub issues. *For builders and teams comfortable running their own infra.*

### 🔵 Managed — **from €49 / month**
We provision and operate the team on your VPS (or ours): setup, a hardened
reverse proxy + cockpit, model routing, monitoring, updates, and a support
channel. You keep root and your data; we keep it healthy. *For founders and small
agencies who want the outcome without the ops.*

### 🟣 Enterprise — **custom**
Custom roles and tools, on-prem / air-gapped deployment, SSO, audit exports,
SLAs, and dedicated engineering. *For organisations with compliance or scale
requirements.*

> Pricing is indicative for the commercial offer around the OSS core. The code in
> this repo is and stays MIT — you can always run it yourself for free.

## Who it's for

- **Indie builders & solo founders** who want a tireless dev/ops teammate they own.
- **Small agencies & studios** running many client projects on shared infra, who can't send client data to a third-party cloud.
- **Privacy-sensitive teams** (health, legal, finance) that need agents on their own metal.
- **Tinkerers** who want a legible, hackable agent framework instead of a black box.

## Safety & scope

Galahad can run shell commands and, with the bridge, write code. Its guardrail
refuses anything destructive or paid without an explicit operator "yes" in the
current conversation. Still: **run it on infrastructure you own, review what your
agents do (journals are plain JSONL), and start with the bridge off.** This is a
power tool, treated as one.

## Contributing

Issues and PRs welcome. The engine is deliberately small and dependency-free —
keep it that way. New roles are just a markdown persona + a `roles.js` entry.

## License

MIT — see [LICENSE](LICENSE).

---

## 🇫🇷 Galahad, en français

**Une équipe d'agents IA autonomes, chez toi — sur un seul serveur, pilotée
depuis Telegram, agnostique à ton fournisseur de LLM.**

Galahad fait tourner une petite **équipe d'agents coordonnés** sur un VPS. Une
seule image, plusieurs **rôles** :

- **🎩 Chef** — l'orchestrateur, face à l'humain. Il route et délègue le dur.
- **🛡️ Guardian** — garde et QA. La patrouille de routine est un simple check shell (zéro token) ; le cerveau ne se réveille que sur anomalie.
- **🛰️ Traveler** — explorateur autonome et bâtisseur de nuit. Il poursuit des objectifs et demande validation avant tout livrable.
- **🧠 Bridge Claude** *(optionnel)* — Claude convocable pour le vrai dev, sous le même garde-fou que toute action payante.

**Pourquoi.** La plupart des « produits à agents » sont le cloud d'un autre qui
détient tes clés, ton code et tes données. Galahad inverse ça : **ton serveur,
tes données, ton fournisseur, garde-fous dans le code** (pas dans un prompt), coût
quasi nul au repos. Honnête sur son périmètre : ce n'est pas un SaaS magique,
c'est un framework lisible (~500 lignes de Node sans dépendances) que tu héberges.

**Démarrer :** `git clone … && cd galahad && ./install.sh`. Il te faut un VPS Linux
avec Docker, trois bots Telegram et une clé pour un endpoint LLM
OpenAI-compatible.

**Tarifs.** Le framework est **libre (MIT, gratuit)**. Autour : **Self-hosted**
(gratuit) · **Managed** (dès 49 €/mois : on l'installe et on l'exploite sur ton
VPS) · **Enterprise** (sur mesure : rôles custom, on-prem, SSO, SLA). Le code de
ce dépôt reste MIT — tu peux toujours l'auto-héberger gratuitement.

**Pour qui.** Builders solo, petites agences avec données clients sensibles,
équipes soucieuses de leur vie privée, bidouilleurs qui veulent un framework
lisible plutôt qu'une boîte noire.

Licence **MIT**.
