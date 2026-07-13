// skill-runner.js — the procedural layer. THIS is what turns a light model into a
// reliable one. A skill is a declarative JSON contract (skills/<name>.json):
//   trigger + preconditions (read, never assumed) + ordered steps + verify (did the
//   effect actually happen?) + rollback.
// The runner wraps the model so it cannot drift: deterministic shell does the work at
// zero token, the model judges ONLY at explicit `decide` points, every effect is
// verified, and the whole run is journalled and written to danmem as shared state.
// The one component of Galahad that never drifted — the patrol — was exactly this shape;
// the runner generalises it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'
import { log } from './journal.js'
import { chat } from './brain.js'
import { guard } from './hooks.js'
import { danmemObserve } from './integrations.js'

const sh = promisify(exec)
const __dir = path.dirname(fileURLToPath(import.meta.url))
// Shipped skills live next to the engine; an agent may add its own under $HOME/skills.
const SKILL_DIRS = [path.join(__dir, '..', 'skills'), path.join(config.home, 'skills')]

export function findSkillFile(name) {
  for (const d of SKILL_DIRS) {
    const p = path.join(d, `${name}.json`)
    if (fs.existsSync(p)) return p
  }
  return null
}

export function listSkills() {
  const seen = new Set()
  for (const d of SKILL_DIRS) {
    let files = []
    try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')) } catch { continue }
    for (const f of files) seen.add(f.replace(/\.json$/, ''))
  }
  return [...seen]
}

// Structural validation — a malformed skill must fail loudly, not half-run.
export function validateSkill(s) {
  const errs = []
  if (!s || typeof s !== 'object') return ['not an object']
  if (!s.name) errs.push('missing name')
  if (!Array.isArray(s.steps) || !s.steps.length) errs.push('steps must be a non-empty array')
  for (const [i, st] of (s.steps || []).entries()) {
    const kinds = ['run', 'decide'].filter((k) => k in (st || {}))
    if (kinds.length !== 1) errs.push(`step ${i}: exactly one of run|decide required`)
  }
  for (const key of ['preconditions', 'verify', 'rollback']) {
    if (s[key] != null && !Array.isArray(s[key])) errs.push(`${key} must be an array`)
  }
  return errs
}

async function runShell(cmd, timeout = 20000) {
  try {
    const { stdout, stderr } = await sh(cmd, { timeout, maxBuffer: 4 << 20 })
    return { ok: true, out: (stdout || '').trim(), err: (stderr || '').trim() }
  } catch (e) {
    return { ok: false, out: (e.stdout || '').trim(), err: (e.stderr || e.message || String(e)).trim().slice(0, 400) }
  }
}

// {{var}} substitution from accumulated step outputs (and initial args).
function subst(str, vars) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`))
}

// Every entry in preconditions/verify/rollback is a shell gate: a non-zero exit = failure.
async function checkAll(list, vars) {
  for (const c of list || []) {
    const cmd = subst(typeof c === 'string' ? c : c.check, vars)
    const r = await runShell(cmd)
    if (!r.ok) return { ok: false, failed: (c && c.desc) || cmd, detail: r.err }
  }
  return { ok: true }
}

// Run a skill by name. opts.by labels the caller (manual | cron | delegation:<who>).
// Returns a structured report; never throws.
export async function runSkill(name, args = {}, opts = {}) {
  const started = new Date().toISOString()
  const file = findSkillFile(name)
  if (!file) return { skill: name, status: 'error', error: `unknown skill "${name}"`, known: listSkills() }
  let skill
  try { skill = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return { skill: name, status: 'error', error: `unparsable skill: ${e.message}` } }
  const verrs = validateSkill(skill)
  if (verrs.length) return { skill: name, status: 'error', error: `invalid skill: ${verrs.join('; ')}` }

  log('skill_start', { skill: name, by: opts.by || 'manual' })
  const vars = { ...args }
  const trace = []
  let finding

  const finish = async (status, extra = {}) => {
    const report = { skill: name, status, started, ended: new Date().toISOString(), by: opts.by || 'manual', finding, trace, ...extra }
    log('skill_end', { skill: name, status, finding: finding ? String(finding).slice(0, 120) : undefined })
    // Shared state: record the run in danmem so other skills (rapport-du-soir, audit…)
    // can read it. Best-effort — danmem being down never fails the skill.
    try {
      await danmemObserve(config.agentName, `skill:${name} → ${status}${finding ? ' — ' + String(finding).slice(0, 400) : ''}`, { strate: 'S2', kind: 'skill_run', source: `skill:${name}` })
    } catch { /* danmem optional */ }
    return report
  }

  // 1 — preconditions (read the world before acting; never assume)
  const pre = await checkAll(skill.preconditions, vars)
  if (!pre.ok) return finish('precondition_failed', { failed: pre.failed, detail: pre.detail })

  // 2 — ordered steps: `run` = deterministic shell (0 token); `decide` = the model judges
  for (const [i, st] of skill.steps.entries()) {
    const as = st.as || `step${i}`
    if ('run' in st) {
      const cmd = subst(st.run, vars)
      if (st.mutating) {
        const g = guard('shell', cmd)
        if (!g.allowed) return finish('blocked', { at: i, reason: g.reason })
      }
      const r = await runShell(cmd, st.timeout || 20000)
      vars[as] = r.ok ? r.out : `[error] ${r.err}`
      trace.push({ step: i, run: cmd.slice(0, 200), ok: r.ok, out: String(vars[as]).slice(0, 400) })
      if (!r.ok && st.required !== false) {
        if (skill.rollback?.length) await checkAll(skill.rollback, vars)
        return finish('step_failed', { at: i, cmd: cmd.slice(0, 200), detail: r.err })
      }
    } else {
      const prompt = subst(st.decide, vars)
      const sys = st.system || 'You are one step inside a Galahad skill. Judge strictly from the data provided — do not invent. Be concise, no preamble.'
      let ans = ''
      try { const m = await chat([{ role: 'system', content: sys }, { role: 'user', content: prompt }]); ans = (m.content || '').trim() } catch (e) { ans = `[decide error] ${e.message}` }
      vars[as] = ans
      finding = ans
      trace.push({ step: i, decide: prompt.slice(0, 200), answer: ans.slice(0, 400) })
    }
  }

  // 3 — verify the effect actually happened (not just that a command returned 0)
  const ver = await checkAll(skill.verify, vars)
  if (!ver.ok) {
    if (skill.rollback?.length) await checkAll(skill.rollback, vars)
    return finish('verify_failed', { failed: ver.failed, detail: ver.detail })
  }

  return finish('ok')
}
