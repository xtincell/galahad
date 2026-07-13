# Patrol pipeline (instance deploy artifacts)

Findings (Talos + Hulysse `data/patrol-findings.md`) → `purge.sh` (08h/18h; sends the
raw findings to Claude via `convoque-claude.py`, appends the synthesis to
`daily-report.md`, archives the raw findings) → `deliver.sh` (19h; pushes the report to
the operator on Telegram, then moves it to `delivered-*.md`).

Installed at `/opt/galahad/patrol/` on the VPS; scheduled by `galahad-patrol.cron`
in `/etc/cron.d/`.

## GOTCHA — the missing user field (cost 6 days of silence, 07→13 Jul 2026)

Files in `/etc/cron.d/` are system crontabs and REQUIRE a user field (6th column, e.g.
`root`) between the schedule and the command:

    0 19 * * * root /opt/galahad/patrol/deliver.sh

Written without it (`0 19 * * * /opt/galahad/patrol/deliver.sh`), cron silently never
runs the job — no error, no log. That is exactly how every purge and delivery died
unnoticed from 7 to 13 July 2026 while 2700+ lines of findings piled up in silence.

Note the asymmetry: `crontab -e` entries do NOT take a user field; `/etc/cron.d/`
entries DO. Do not copy one format into the other.

## TODO (product / generic)

Parameterise the hardcoded instance values (Telegram chat_id, hermes volume path in
`deliver.sh`) into env before this pipeline leaves `deploy/` for the generic engine.
