#!/usr/bin/env node
// Galahad engine — one entrypoint, role-configured. Telegram gateway + rolling
// agentic loop + optional autonomous heartbeat. Zero build, zero inbound port.
import fs from 'node:fs'
import { config } from './config.js'
import { log } from './journal.js'
import { pollLoop, send, typing } from './telegram.js'
import { think, resetSession } from './agent-loop.js'
import { grantFromUser } from './hooks.js'
import { getModel, setModel, tokensUsed } from './brain.js'
import { ensureMemory, readIndex } from './memory.js'
import { heartbeat, statusText, getPatrolMinutes, setPatrolMinutes } from './heartbeat.js'
import { pendingGoals, addGoal, formatGoals } from './goals.js'

for (const dir of [config.home, config.memoryDir, config.journalDir, config.dataDir, config.workspace]) {
  fs.mkdirSync(dir, { recursive: true })
}
ensureMemory()

const HELP = `🔷 ${config.agentName} — ${config.roleDef.title} (Galahad)
/status — vitals + brain + tokens
/brain — show brain · /brain <model> — swap it (hot)
/patrol — show cadence · /patrol <min> — set it (hot)
/goal — show goals · /goal <objective> — add one (guides night work)
/memory — memory index
/new — fresh conversation
/help — this message
Brain endpoint agnostic (OpenAI-compatible). Model: ${config.model}.`

async function onMessage(text) {
  log('message_in', { text: text.slice(0, 300) })
  if (['/start', '/help', '/aide'].includes(text)) return send(HELP)
  if (text === '/new') { resetSession(); return send('🧹 Fresh conversation — previous thread closed.') }
  if (text === '/status') return send(await statusText())
  if (text === '/memory') return send('🧠 ' + (readIndex().slice(0, 3500) || 'empty'))
  if (text === '/brain' || text.startsWith('/brain ')) {
    const arg = text.slice(6).trim()
    if (!arg) return send(`🧠 Brain: *${getModel()}* · tokens today: ${tokensUsed()}\nSwap: /brain <model>`)
    setModel(arg); log('brain_swap', { model: arg })
    return send(`🧠 Brain → *${arg}* (immediate).`)
  }
  if (text === '/patrol' || text.startsWith('/patrol ')) {
    const arg = text.slice(7).trim()
    if (!arg) return send(`🛡️ Patrol: *every ${getPatrolMinutes()} min* (default ${config.heartbeatMinutes}).\nSet hot: /patrol <minutes> — e.g. /patrol 3 (1-1440).`)
    const n = Number(arg)
    if (!Number.isFinite(n) || n < 1 || n > 1440) return send('⚠️ Give a number of minutes between 1 and 1440.')
    const set = setPatrolMinutes(n); log('patrol_set', { minutes: set })
    return send(`🛡️ Patrol cadence → *every ${set} min* (takes effect next cycle, persistent).`)
  }

  if (text === '/goal' || text.startsWith('/goal ')) {
    const arg = text.slice(5).trim()
    if (!arg) return send(`🎯 Goals:\n${formatGoals(pendingGoals())}\nAdd: /goal <objective>`)
    const n = addGoal(arg); log('goal_add', {})
    return send(`🎯 Goal added (${n} total). It guides the night-exploration window.`)
  }

  // Any operator message can authorise an engaging action for the next 5 min.
  grantFromUser(text)

  typing()
  const keep = setInterval(typing, 4500)
  try {
    const { text: answer } = await think({ prompt: text })
    if (answer) await send(answer)
  } finally { clearInterval(keep) }
}

log('boot', { role: config.role, model: getModel(), heartbeat: getPatrolMinutes() })
send(`${config.agentName} online — role ${config.role}, brain ${getModel()}. /help`)

if (config.heartbeatMinutes > 0) {
  // Self-rescheduling patrol: re-reads the cadence EACH cycle → hot-adjustable, no restart.
  const schedulePatrol = () => setTimeout(
    () => heartbeat().catch((e) => log('heartbeat_error', { error: String(e) })).finally(schedulePatrol),
    getPatrolMinutes() * 60_000,
  )
  schedulePatrol()
  heartbeat().catch((e) => log('heartbeat_error', { error: String(e) }))
}

process.on('SIGTERM', () => { log('shutdown'); process.exit(0) })
process.on('SIGINT', () => { log('shutdown'); process.exit(0) })

pollLoop(onMessage)
