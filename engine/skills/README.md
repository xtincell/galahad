# Galahad skills — the procedural layer

A **skill** is a declarative JSON contract that wraps a light model so it cannot drift.
The deterministic shell does the work at zero token; the model judges **only** at explicit
`decide` points; every effect is **verified**; the whole run is journalled and written to
danmem as shared state. This is the shape of the one component that never drifted (the
patrol) — generalised.

> Memory tells an agent *what it knows*. A skill tells it *how to act reliably*.
> The model provides judgement **inside** the structure, not **instead of** it.

## Anatomy (`skills/<name>.json`)

```json
{
  "name": "diagnostic-coolify",
  "description": "one line — what it does and whether it mutates",
  "trigger": ["manual", "cron", "delegation"],

  "preconditions": [
    { "check": "docker info >/dev/null 2>&1", "desc": "docker reachable" }
  ],

  "steps": [
    { "run": "docker ps --format '{{.Names}} {{.Status}}'", "as": "state" },
    { "run": "systemctl restart foo", "as": "r", "mutating": true },
    { "decide": "Given {{state}}, is anything wrong? Name it or say RAS.", "as": "verdict" }
  ],

  "verify": [
    { "check": "curl -sf http://localhost:8790/health", "desc": "service back up" }
  ],

  "rollback": [ { "check": "systemctl start foo" } ],
  "on_failure": "report"
}
```

### Fields

- **preconditions** — shell gates read *before* acting. Any non-zero exit aborts the skill
  with `precondition_failed` (nothing ran). Never assume state; check it.
- **steps** — ordered. Each is exactly one of:
  - **`run`** — a shell command (0 token). Its stdout is stored under `as` for later
    `{{substitution}}`. Add `"mutating": true` to route it through the guard (destructive/
    paid commands need consent). `"required": false` lets a step fail without aborting.
    `"timeout"` in ms (default 20000).
  - **`decide`** — the model's judgement, the ONLY inference point. The prompt (with
    `{{vars}}` substituted) plus an optional `"system"` string go to the brain; the answer
    is stored under `as` and becomes the skill's `finding`. Keep decides closed and
    data-bound ("given X, is Y true?"), never open-ended.
- **verify** — shell gates run *after* the steps to confirm the effect actually happened
  (not merely that a command returned 0). Failure ⇒ `verify_failed` (+ rollback).
- **rollback** — shell gates run on any step/verify failure. Best-effort.
- **`{{var}}`** — substitutes a prior step's `as` output (or an initial arg). Docker's own
  `{{.Field}}` templates are left untouched (only `{{word}}` is substituted).

## Running

- Brain tool: `run_skill(name, args)` / `list_skills()`.
- Programmatic: `runSkill(name, args, { by })` from `skill-runner.js`.
- Every run returns a structured report `{ status, finding, trace, … }` where status ∈
  `ok | precondition_failed | step_failed | blocked | verify_failed | error`, and is
  written to danmem (`kind: skill_run`) so other skills can read it.

## Where they live

Shipped skills sit in `engine/skills/` (deployed next to the engine). An agent may add its
own under `$GALAHAD_HOME/skills/`. Both directories are searched; the shipped copy wins on
name clash only if the local one is absent.
