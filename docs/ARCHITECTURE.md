# Galahad — architecture

Galahad runs a small **team of autonomous LLM agents** on a single machine. One
engine image; each container is the same code wearing a different **role**.

```
                       ┌──────────────────────────────────────────┐
   Telegram            │                 one VPS                   │
   (operator) ───┬────▶│  ┌────────┐  ┌──────────┐  ┌───────────┐  │
                 │     │  │  Chef  │  │ Guardian │  │  Traveler │  │
                 │     │  │ orchestr. │ health/QA │  │ explore/build│
                 │     │  └────┬───┘  └────┬─────┘  └─────┬─────┘  │
                 │     │       │  shared memory volume    │        │
                 │     │       └──────────┬───────────────┘        │
                 │     │                  ▼                        │
                 │     │           ┌─────────────┐                 │
                 └─────┼──────────▶│ Claude bridge│ (optional)     │
                       │           │ heavy dev    │                │
                       │           └─────────────┘                 │
                       │   brain: any OpenAI-compatible endpoint    │
                       └──────────────────────────────────────────┘
```

## The engine (`engine/`)
A ~500-line Node service, **zero build, zero npm dependencies**. One process per
role. Its parts:

| File            | Responsibility                                                    |
|-----------------|-------------------------------------------------------------------|
| `config.js`     | Reads all config from env. No secrets in code.                    |
| `roles.js`      | The three built-in roles + defaults. Add your own here.           |
| `brain.js`      | Thin client over any OpenAI-compatible `/chat/completions`.       |
| `telegram.js`   | Long-poll gateway, single authorised chat id, no inbound port.    |
| `agent-loop.js` | System prompt (SOUL + memory) → brain → tools → … → answer.       |
| `tools.js`      | `shell`, `read_file`, `remember`, `recall`, `call_claude`.        |
| `hooks.js`      | **Guardrails**: block destructive/paid actions without a yes.     |
| `memory.js`     | Markdown memory cards + an index injected at wake-up.             |
| `heartbeat.js`  | Cheap shell probe; wakes the brain only on anomaly / night.       |
| `journal.js`    | Append-only JSONL, one file per day. Secrets never written.       |

Roles are just markdown personas in `engine/roles/*.md` (the "SOUL") plus a few
defaults in `roles.js`. Cloning a role = copy a markdown file and add an entry.

## The three roles
- **Chef** — human-facing orchestrator. Human-driven (no heartbeat). Routes and
  delegates.
- **Guardian** — reactive patrol + code QA. 5-min shell heartbeat, brain only on
  anomaly. Read-mostly.
- **Traveler** — autonomous explorer + night-shift builder. 30-min heartbeat,
  works goals at night, delegates heavy dev to the bridge.

## The Claude bridge (`bridge/`)
Optional. Wraps the Claude CLI behind a token-protected internal HTTP endpoint so
any agent can delegate real coding via the `call_claude` tool. Runs only when you
opt in (`--profile bridge`) and provide an Anthropic key. Costs are gated by the
same guardrail as any paid action.

## Why it's cheap
Routine patrol is pure shell (**zero tokens**). Cheap models execute; strong
models diagnose; the expensive Claude bridge is summoned only for peaks. A team
can idle 24/7 at near-zero cost.

## Why it's agnostic
- Brain = any OpenAI-compatible endpoint (`LLM_BASE_URL`). Swap providers, or
  swap a model live with `/brain <model>`.
- Config = 100% environment. No operator secret is baked into any image.
- Transport = Docker + Compose. Runs on any Linux VPS.

## Safety model
Guardrails are enforced in **code**, not by prompt wording. A destructive shell
command or a paid call is refused unless the operator said a consent word
(`yes`, `go`, `ok`, `oui`…) within the last 5 minutes. The model cannot argue
past `hooks.js`.
