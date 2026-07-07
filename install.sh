#!/usr/bin/env bash
# Galahad installer — get a team of autonomous agents running on any Linux VPS.
# Idempotent, dependency-light. Interactive by default; fully non-interactive if
# a .env already exists (CI / provisioning).
set -euo pipefail

BOLD=$(tput bold 2>/dev/null || true); DIM=$(tput dim 2>/dev/null || true); RST=$(tput sgr0 2>/dev/null || true)
say()  { printf '%s\n' "${BOLD}▸ $*${RST}"; }
note() { printf '%s\n' "${DIM}  $*${RST}"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
say "Checking prerequisites"
command -v docker >/dev/null || die "Docker not found. Install it: https://docs.docker.com/engine/install/"
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "Docker Compose v2 not found."; fi
note "docker + compose OK"

# ── 2. Configuration ─────────────────────────────────────────────────────────
if [ -f .env ]; then
  say ".env already present — using it (non-interactive)"
else
  cp .env.example .env
  if [ -t 0 ]; then
    setup_mode=2
    if command -v node >/dev/null 2>&1; then
      say "How do you want to configure Galahad?"
      echo "  1) Web interface (mouse, recommended)"
      echo "  2) Terminal (CLI prompts)"
      read -r -p "  Choice [1]: " setup_mode
      setup_mode="${setup_mode:-1}"
    else
      note "Node.js not found — falling back to the terminal wizard."
    fi

    if [ "$setup_mode" = "1" ]; then
      IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
      [ -z "$IP" ] && IP="$(curl -s --max-time 2 ifconfig.me 2>/dev/null || true)"
      [ -z "$IP" ] && IP="localhost"
      say "Launching the web setup wizard"
      note "Open http://${IP}:${SETUP_PORT:-8080} in your browser"
      note "(Ctrl+C here stops the wizard; re-run ./install.sh to fall back to the CLI)"
      exec node setup/server.mjs
    fi

    say "Let's configure Galahad (values are written to .env)"
    prompt() { local var="$1" msg="$2" def="${3:-}" val
      read -r -p "  ${msg}${def:+ [$def]}: " val; val="${val:-$def}"
      # portable in-place edit
      sed -i.bak "s|^${var}=.*|${var}=${val//|/\\|}|" .env && rm -f .env.bak
    }
    prompt OPERATOR_CHAT_ID          "Your Telegram chat id"
    prompt CHEF_TELEGRAM_BOT_TOKEN   "Chef bot token (@BotFather)"
    prompt GUARDIAN_TELEGRAM_BOT_TOKEN "Guardian bot token"
    prompt TRAVELER_TELEGRAM_BOT_TOKEN "Traveler bot token"
    prompt LLM_BASE_URL              "LLM endpoint (OpenAI-compatible)" "https://ollama.com/v1"
    prompt LLM_API_KEY               "LLM API key"
    prompt WORKSPACE_HOST            "Host path for the shared workspace" "$ROOT/workspace"
    read -r -p "  Enable the Claude bridge? (y/N): " wantbridge
    if [[ "${wantbridge:-N}" =~ ^[Yy] ]]; then
      prompt CLAUDE_BRIDGE_TOKEN "Bridge token (invent a strong one)" "$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      prompt ANTHROPIC_API_KEY  "Anthropic API key"
      BRIDGE=1
    fi
  else
    note "Non-interactive shell and no .env — copied .env.example. Edit .env then re-run."
    exit 0
  fi
fi

mkdir -p "$(grep -E '^WORKSPACE_HOST=' .env | cut -d= -f2- )" 2>/dev/null || true

# ── 3. Build & launch ────────────────────────────────────────────────────────
say "Building images"
$DC build

say "Starting the team"
if [ "${BRIDGE:-0}" = "1" ] || grep -qE '^CLAUDE_BRIDGE_TOKEN=.+' .env; then
  $DC --profile bridge up -d
else
  $DC up -d
fi

# ── 4. Optional edge routing ─────────────────────────────────────────────────
cat <<EOF

${BOLD}✓ Galahad is up.${RST}
  ${DIM}Agents:${RST} chef, guardian, traveler $( [ "${BRIDGE:-0}" = "1" ] && echo "+ claude-bridge" )
  ${DIM}Logs:  ${RST} $DC logs -f guardian
  ${DIM}Cockpit:${RST} open cockpit/index.html (or serve it behind your reverse proxy)

Message any of your bots on Telegram and send /help.

Edge routing (optional): reverse-proxy templates are in ./routing
  • Caddy   → routing/Caddyfile.example
  • Traefik → routing/traefik-dynamic.example.yml
EOF
