// Heartbeat — the Guardian's structured radar patrol. Cheap by design: a routine
// tick is a pure, ordered shell sweep (zero tokens). The brain is woken only when
// the sweep finds a real anomaly (guardian) or during the night window (traveler).
//
// The patrol is a fixed 7-check protocol run in order. Each check is fenced: a
// check that fails to run (docker socket down, permission denied) is NOT swallowed
// — it becomes an explicit alert. Every patrol maintains ETAT_DU_MONDE.md, the
// living "state of the world" file the operator can read at any time.
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'
import { think } from './agent-loop.js'
import { send } from './telegram.js'
import { log } from './journal.js'

const sh = promisify(exec)

// Run one shell command, classifying the outcome. `absent` distinguishes a tool
// that simply isn't installed (fine) from one that is present but errored (alert).
async function run(cmd, { timeout = 8000 } = {}) {
  try {
    const { stdout } = await sh(cmd, { timeout })
    return { ok: true, out: stdout.trim() }
  } catch (e) {
    return { ok: false, err: (e.stderr || e.message || String(e)).trim().slice(0, 300) }
  }
}

// ── The ordered patrol ──────────────────────────────────────────────────────
// Each step returns { status: 'ok'|'warn'|'fail'|'skip', label, detail }.
// 'warn' = anomaly (alert). 'fail' = the check itself could not run (alert).

// 1 — Containers: any that are not running (exited/dead) are flagged.
async function checkContainers() {
  const has = await run('command -v docker >/dev/null 2>&1 && echo yes || echo no')
  if (has.out === 'no') return { status: 'skip', label: 'containers', detail: 'docker not installed' }
  const r = await run(`docker ps -a --format '{{json .}}'`)
  if (!r.ok) return { status: 'fail', label: 'containers', detail: `docker unreachable: ${r.err}` }
  const dead = []
  let running = 0
  for (const line of r.out.split('\n').filter(Boolean)) {
    let c
    try { c = JSON.parse(line) } catch { continue }
    const state = (c.State || '').toLowerCase()
    if (state === 'running') { running++; continue }
    // Ignore intentionally-created-but-never-started one-shots; flag exited/dead.
    if (state === 'exited' || state === 'dead' || state === 'restarting')
      dead.push(`${c.Names} (${c.Status || state})`)
  }
  if (dead.length) return { status: 'warn', label: 'containers', detail: `${running} up · down: ${dead.join(', ')}` }
  return { status: 'ok', label: 'containers', detail: `${running} running` }
}

// 2 — Disk: any mount over the warn threshold.
async function checkDisk() {
  const r = await run(`df -hP 2>/dev/null | awk 'NR>1{print $5"|"$6}'`)
  if (!r.ok) return { status: 'fail', label: 'disk', detail: `df failed: ${r.err}` }
  const hot = []
  let root = '?'
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [pctRaw, mount] = line.split('|')
    const pct = Number((pctRaw || '').replace('%', ''))
    if (mount === '/') root = pctRaw
    if (Number.isFinite(pct) && pct >= config.diskWarnPct) hot.push(`${mount} ${pctRaw}`)
  }
  if (hot.length) return { status: 'warn', label: 'disk', detail: `over ${config.diskWarnPct}%: ${hot.join(', ')}` }
  return { status: 'ok', label: 'disk', detail: `/ ${root}` }
}

// 3 — Memory: used share of RAM.
async function checkRam() {
  const r = await run(`free -m 2>/dev/null | awk '/Mem:/{print $3"|"$2}'`)
  if (!r.ok || !r.out) return { status: 'fail', label: 'ram', detail: `free failed: ${r.err || 'no output'}` }
  const [used, total] = r.out.split('|').map(Number)
  if (!total) return { status: 'fail', label: 'ram', detail: 'unparsable free output' }
  const pct = Math.round((used / total) * 100)
  if (pct >= config.ramWarnPct) return { status: 'warn', label: 'ram', detail: `${pct}% used (${used}/${total}MB)` }
  return { status: 'ok', label: 'ram', detail: `${pct}% used (${used}/${total}MB)` }
}

// 4 — Journals: the role's own journal dir must exist and be recent.
async function checkJournals() {
  const dir = config.journalDir
  let files
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
  } catch (e) {
    if (e.code === 'ENOENT') return { status: 'skip', label: 'journals', detail: 'no journal dir yet' }
    return { status: 'fail', label: 'journals', detail: `cannot read ${dir}: ${e.message}` }
  }
  if (!files.length) return { status: 'skip', label: 'journals', detail: 'no journals yet' }
  const latest = files[files.length - 1]
  const ageH = (Date.now() - fs.statSync(path.join(dir, latest)).mtimeMs) / 3.6e6
  const detail = `${files.length} file(s), latest ${latest} (${ageH.toFixed(1)}h old)`
  // Guardian patrols every few minutes, so its own journal going quiet for >2h is odd.
  if (ageH > 2) return { status: 'warn', label: 'journals', detail: `${detail} — stale` }
  return { status: 'ok', label: 'journals', detail }
}

// 5 — Errors: scan the last 24h of journals for error events.
async function checkErrors() {
  const dir = config.journalDir
  const days = [0, 1].map((d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10))
  const paths = days.map((d) => path.join(dir, `${d}.jsonl`)).filter(fs.existsSync)
  if (!paths.length) return { status: 'skip', label: 'errors', detail: 'no recent journals' }
  const r = await run(`grep -ihc error ${paths.map((p) => `'${p}'`).join(' ')} 2>/dev/null | awk '{s+=$1} END{print s+0}'`)
  if (!r.ok) return { status: 'fail', label: 'errors', detail: `grep failed: ${r.err}` }
  const n = Number(r.out) || 0
  if (n > 0) return { status: 'warn', label: 'errors', detail: `${n} error line(s) in last 24h journals` }
  return { status: 'ok', label: 'errors', detail: 'clean (24h)' }
}

// The full sweep, in fixed order.
async function patrol() {
  const steps = []
  steps.push(await checkContainers())
  steps.push(await checkDisk())
  steps.push(await checkRam())
  steps.push(await checkJournals())
  steps.push(await checkErrors())
  const warns = steps.filter((s) => s.status === 'warn')
  const fails = steps.filter((s) => s.status === 'fail')
  return { at: new Date().toISOString(), steps, warns, fails }
}

const ICON = { ok: '🟢', warn: '🟠', fail: '🔴', skip: '⚪' }

// The living state-of-the-world file — rewritten every patrol.
function writeEtatDuMonde(report) {
  const lines = [
    `# 🛡️ ÉTAT DU MONDE — ${config.agentName}`,
    '',
    `_Updated: ${report.at} · role: ${config.role} · every ${config.heartbeatMinutes} min_`,
    '',
    report.fails.length ? `**⚠️ ${report.fails.length} check(s) could not run.**`
      : report.warns.length ? `**🟠 ${report.warns.length} anomaly(ies) detected.**`
      : '**🟢 All clear.**',
    '',
    '| # | Check | Status | Detail |',
    '|---|-------|--------|--------|',
    ...report.steps.map((s, i) => `| ${i + 1} | ${s.label} | ${ICON[s.status]} ${s.status} | ${s.detail} |`),
    '',
  ]
  try {
    fs.mkdirSync(config.memoryDir, { recursive: true })
    fs.writeFileSync(path.join(config.memoryDir, 'ETAT_DU_MONDE.md'), lines.join('\n'))
  } catch (e) {
    log('etat_du_monde_write_error', { error: String(e) })
  }
}

function isNight() {
  const h = Number(new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: config.timezone }))
  const { nightStartHour: s, nightEndHour: e } = config
  return s > e ? h >= s || h < e : h >= s && h < e
}

// /status — a cheap live snapshot (zero tokens), independent of the patrol.
export async function statusText() {
  const [load, mem, disk, docker] = await Promise.all([
    run("cat /proc/loadavg 2>/dev/null | awk '{print $1}'"),
    run("free -m 2>/dev/null | awk '/Mem:/{printf \"%d/%d\", $3, $2}'"),
    run("df -h / 2>/dev/null | awk 'NR==2{print $5}'"),
    run("command -v docker >/dev/null && docker ps -q 2>/dev/null | wc -l || echo n/a"),
  ])
  return `🩺 ${config.agentName} · role=${config.role}\n` +
    `load ${load.out || '?'} · mem ${mem.out || '?'}MB · disk / ${disk.out || '?'} · containers ${docker.out || '?'}\n` +
    `model ${config.model} · tz ${config.timezone}`
}

// The autonomous pulse. Guardian: ordered patrol + ETAT_DU_MONDE + alert-on-anomaly.
// Traveler: same cheap sweep, plus the night-exploration brain window it always had.
export async function heartbeat() {
  const report = await patrol()
  log('patrol', { warns: report.warns.length, fails: report.fails.length })
  writeEtatDuMonde(report)

  // Explicit failure handling: a check that could not run is surfaced, never
  // silently swallowed. This is the radar rule — if an instrument is blind, say so.
  if (report.fails.length) {
    const body = report.fails.map((f) => `🔴 ${f.label}: ${f.detail}`).join('\n')
    await send(`🛡️ ${config.agentName} — patrol check(s) could not run:\n${body}`).catch((e) => log('alert_send_error', { error: String(e) }))
  }

  // Anomaly handling: zero-token Telegram alert with the offending details.
  if (report.warns.length) {
    const body = report.warns.map((w) => `🟠 ${w.label}: ${w.detail}`).join('\n')
    await send(`🛡️ ${config.agentName} — anomaly on patrol:\n${body}`).catch((e) => log('alert_send_error', { error: String(e) }))
  }

  // All clear → silent. The journal + ETAT_DU_MONDE.md hold the record; no Telegram spam.

  // Escalation — wake the brain ONLY on a real anomaly (guardian) or in the night
  // window (traveler). Everything above is zero-token; tokens are spent only here.
  const anomaly = report.warns.length > 0 || report.fails.length > 0
  const wake = config.brainOnEvent && (anomaly || (config.role === 'traveler' && isNight()))
  if (!wake) return

  const reason = anomaly
    ? `patrol found: ${[...report.fails, ...report.warns].map((s) => `${s.label}=${s.detail}`).join(' | ')}`
    : 'night exploration window'
  try {
    const { text } = await think({
      prompt: `Autonomous tick — ${reason}. Investigate briefly with your tools if useful, then report one concise finding or "nothing to report". Do not take any engaging action without asking.`,
    })
    if (text && !/nothing to report/i.test(text)) await send(`🛰️ ${config.agentName}: ${text}`)
  } catch (e) {
    log('heartbeat_brain_error', { error: String(e) })
  }
}
