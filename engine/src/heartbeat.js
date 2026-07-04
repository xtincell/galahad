// Heartbeat — the autonomous pulse. Cheap by design: a routine tick is a pure
// shell probe (zero tokens). The brain is only woken when the probe finds
// something worth analysing (guardian) or during the night window (traveler).
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'
import { think } from './agent-loop.js'
import { send } from './telegram.js'
import { log } from './journal.js'

const sh = promisify(exec)

async function probe() {
  // Zero-token vitals. Works on any Linux box.
  const cmds = {
    load: "cat /proc/loadavg 2>/dev/null | awk '{print $1}'",
    mem: "free -m 2>/dev/null | awk '/Mem:/{printf \"%d/%d\", $3, $2}'",
    disk: "df -h / 2>/dev/null | awk 'NR==2{print $5}'",
    docker: "command -v docker >/dev/null && docker ps -q 2>/dev/null | wc -l || echo n/a",
  }
  const out = {}
  for (const [k, c] of Object.entries(cmds)) {
    try { out[k] = (await sh(c, { timeout: 8000 })).stdout.trim() } catch { out[k] = 'err' }
  }
  return out
}

function isNight() {
  const h = Number(new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: config.timezone }))
  const { nightStartHour: s, nightEndHour: e } = config
  return s > e ? h >= s || h < e : h >= s && h < e
}

// Rough anomaly heuristic — disk > 90% or load spiking.
function anomaly(v) {
  const disk = Number((v.disk || '').replace('%', ''))
  const load = Number(v.load)
  return (disk >= 90) || (load >= 8)
}

export async function statusText() {
  const v = await probe()
  return `🩺 ${config.agentName} · role=${config.role}\nload ${v.load} · mem ${v.mem}MB · disk / ${v.disk} · containers ${v.docker}\nmodel ${config.model} · tz ${config.timezone}`
}

export async function heartbeat() {
  const v = await probe()
  log('heartbeat', v)
  const wake = config.brainOnEvent && (anomaly(v) || (config.role === 'traveler' && isNight()))
  if (!wake) return

  const reason = anomaly(v) ? `anomaly detected: ${JSON.stringify(v)}` : 'night exploration window'
  try {
    const { text } = await think({
      prompt: `Autonomous tick — ${reason}. Investigate briefly with your tools if useful, then report one concise finding or "nothing to report". Do not take any engaging action without asking.`,
    })
    if (text && !/nothing to report/i.test(text)) await send(`🛰️ ${config.agentName}: ${text}`)
  } catch (e) {
    log('heartbeat_brain_error', { error: String(e) })
  }
}
