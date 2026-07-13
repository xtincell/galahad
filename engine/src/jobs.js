// jobs.js — the delegation CONSUMER (Galahad Phase 3). A director has no inbound port,
// so it PULLS its pending jobs from danmem on a short timer, claims one atomically (only
// one puller wins), runs the skill through the same verified runtime, and writes the
// result back. This is the receiving half of the bus; the sending half is any agent (Dan,
// the operator) POSTing a job to danmem. Zero tokens unless a claimed skill has a `decide`.
import { config } from './config.js'
import { log } from './journal.js'
import { runSkill } from './skill-runner.js'
import { danmemJobs } from './integrations.js'

let busy = false

export async function processJobs() {
  if (!config.danmemUrl || busy) return
  busy = true
  try {
    let pending
    try { pending = await danmemJobs.pending(config.agentName) } catch { return } // danmem down → skip quietly
    for (const job of pending) {
      let claimed
      try { claimed = await danmemJobs.claim(job.id) } catch { continue }
      if (!claimed) continue // another puller already took it
      log('job_claimed', { id: job.id, skill: job.skill, from: job.from_agent })
      let report
      try { report = await runSkill(job.skill, job.args || {}, { by: `delegation:${job.from_agent}` }) }
      catch (e) { report = { skill: job.skill, status: 'error', error: String(e?.message || e).slice(0, 300) } }
      const status = report.status === 'ok' ? 'done' : 'failed'
      try { await danmemJobs.complete(job.id, status, report) } catch (e) { log('job_complete_error', { id: job.id, error: String(e).slice(0, 120) }) }
      log('job_done', { id: job.id, status, finding: report.finding ? String(report.finding).slice(0, 120) : undefined })
    }
  } finally { busy = false }
}

// Self-rescheduling poll loop, independent of the patrol cadence so delegation stays
// responsive (a director patrols hourly, but should answer a delegated job in seconds).
export function startJobLoop() {
  if (!config.danmemUrl) return
  const ms = Number(process.env.GALAHAD_JOB_POLL_S || 45) * 1000
  const tick = () => processJobs().catch((e) => log('job_loop_error', { error: String(e) })).finally(() => setTimeout(tick, ms))
  setTimeout(tick, 5000)
  log('job_loop_started', { poll_s: ms / 1000 })
}
