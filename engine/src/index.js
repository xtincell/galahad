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
import { heartbeat, statusText } from './heartbeat.js'

for (const dir of [config.home, config.memoryDir, config.journalDir, config.dataDir, config.workspace]) {
  fs.mkdirSync(dir, { recursive: true })
}
ensureMemory()

const HELP = `🔷 ${config.agentName} — ${config.roleDef.title} (Galahad)
/status — vitals + brain + tokens
/brain — show brain · /brain <model> — swap it (hot)
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

  // Any operator message can authorise an engaging action for the next 5 min.
  grantFromUser(text)

  typing()
  const keep = setInterval(typing, 4500)
  try {
    const { text: answer } = await think({ prompt: text })
    if (answer) await send(answer)
  } finally { clearInterval(keep) }
}

log('boot', { role: config.role, model: getModel(), heartbeat: config.heartbeatMinutes })
send(`${config.agentName} online — role ${config.role}, brain ${getModel()}. /help`)

if (config.heartbeatMinutes > 0) {
  setInterval(() => heartbeat().catch((e) => log('heartbeat_error', { error: String(e) })), config.heartbeatMinutes * 60_000)
  heartbeat().catch((e) => log('heartbeat_error', { error: String(e) }))
}

process.on('SIGTERM', () => { log('shutdown'); process.exit(0) })
process.on('SIGINT', () => { log('shutdown'); process.exit(0) })

pollLoop(onMessage)
