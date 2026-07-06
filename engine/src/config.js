// Galahad engine — configuration.
// Everything comes from the environment. No secret is ever hard-coded.
// One engine, many roles: the ROLE variable selects which persona/behaviour
// this process runs as (chef | guardian | traveler). See roles.js.
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLES } from './roles.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function req(name) {
  const v = process.env[name]
  if (!v || v.startsWith('REPLACE') || v.startsWith('REMPLACE')) {
    console.error(`[config] missing required variable: ${name}`)
    process.exit(1)
  }
  return v
}

const roleKey = (process.env.GALAHAD_ROLE || 'chef').toLowerCase()
const role = ROLES[roleKey]
if (!role) {
  console.error(`[config] unknown GALAHAD_ROLE="${roleKey}". Valid: ${Object.keys(ROLES).join(', ')}`)
  process.exit(1)
}

const home = process.env.GALAHAD_HOME || path.join(os.homedir(), '.galahad', roleKey)

export const config = {
  role: roleKey,
  roleDef: role,
  agentName: process.env.GALAHAD_NAME || role.defaultName,

  // Channel — a single authorised human, over Telegram.
  telegramToken: req('TELEGRAM_BOT_TOKEN'),
  telegramChatId: String(req('TELEGRAM_CHAT_ID')),

  // Brain — ANY OpenAI-compatible endpoint. Ollama Cloud, local Ollama,
  // OpenAI, Together, Groq, OpenRouter… agnostic by construction.
  brainBaseUrl: process.env.LLM_BASE_URL || 'https://ollama.com/v1',
  brainKey: req('LLM_API_KEY'),
  model: process.env.GALAHAD_MODEL || role.defaultModel,
  maxTurns: Number(process.env.GALAHAD_MAX_TURNS || 24),
  dailyTokenBudget: Number(process.env.GALAHAD_DAILY_TOKENS || 3_000_000),

  // Cadence — heartbeat / patrol / night exploration.
  heartbeatMinutes: Number(process.env.GALAHAD_HEARTBEAT_MINUTES || role.heartbeatMinutes),
  nightStartHour: Number(process.env.GALAHAD_NIGHT_START || 22),
  nightEndHour: Number(process.env.GALAHAD_NIGHT_END || 6),
  timezone: process.env.GALAHAD_TZ || 'UTC',
  brainOnEvent: (process.env.GALAHAD_BRAIN_ON_EVENT ?? 'true') === 'true',

  // Guardian patrol thresholds — shell-level, zero-token anomaly gates.
  diskWarnPct: Number(process.env.GALAHAD_DISK_WARN || 80),
  ramWarnPct: Number(process.env.GALAHAD_RAM_WARN || 90),
  loadWarn: Number(process.env.GALAHAD_LOAD_WARN || 8),

  // Claude bridge — optional heavy-dev tool the agents can call.
  bridgeUrl: process.env.CLAUDE_BRIDGE_URL || null,
  bridgeToken: process.env.CLAUDE_BRIDGE_TOKEN || null,

  // Shared workspace the team can read/act on (mounted volume).
  workspace: process.env.GALAHAD_WORKSPACE || path.join(home, 'workspace'),

  // Paths
  home,
  memoryDir: path.join(home, 'memory'),
  journalDir: path.join(home, 'journal'),
  dataDir: path.join(home, 'data'),

  // Talos integrations: radars + shared memory (integrations.js).
  radar: {
    matanga: { url: process.env.RADAR_MATANGA_URL || '', key: process.env.RADAR_MATANGA_KEY || '' },
    perso: { url: process.env.RADAR_PERSO_URL || '', key: process.env.RADAR_PERSO_KEY || '' },
  },
  danmemUrl: process.env.DANMEM_URL || null,
  danmemToken: process.env.DANMEM_TOKEN || null,
  soulFile: process.env.GALAHAD_SOUL || path.join(pkgRoot, 'roles', `${roleKey}.md`),
}
