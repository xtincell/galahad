// Programmatic guardrails — the safety net that makes autonomy trustworthy.
// Rule: nothing destructive or paid runs without consent. Consent comes three ways:
//   1. chat   — the operator says an approval word in chat (short 5-min window)
//   2. scoped — the operator pre-authorises a bounded window via /grant <minutes>
//               (file-backed → survives restart, so unattended night work needn't
//                wait on a human who is asleep)
//   3. night  — opt-in per role (GALAHAD_NIGHT_AUTOGRANT): during the configured
//               night window the traveler's pre-approved objectives may act alone.
// Enforced in code, not by prompt politeness — the model cannot talk its way past
// it, and every pass/block is journalled so the log never lies about what ran.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log } from './journal.js'

const GRANT_WINDOW_MS = 5 * 60_000
let grantedUntil = 0
const consentFile = path.join(config.dataDir, 'consent.json')

// Words that count as an explicit go-ahead in the current conversation.
const CONSENT = /\b(oui|vas[- ]y|go|ok|d'accord|confirme|autorise|yes|approve|proceed|do it)\b/i

// A shell command is "engaging" if it can destroy, spend, or take prod down.
const DANGEROUS = [
  /\brm\s+-rf?\b/, /\bmkfs\b/, /\bdd\s+if=/, /\b(docker|podman)\s+(rm|rmi|kill|stop|prune)\b/,
  /\bdocker\s+compose\s+(down|rm)\b/, /\bshutdown\b/, /\breboot\b/, /\bkill(all)?\b/,
  /\bgit\s+push\b.*--force/, /\b(drop|truncate|delete)\s+(table|database|from)\b/i,
  /\bapt(-get)?\s+(remove|purge)\b/, /:\s*>\s*\//, /\bchmod\s+-R\b/, /\bchown\s+-R\b/,
]

export function grantFromUser(text) {
  if (CONSENT.test(text)) {
    grantedUntil = Date.now() + GRANT_WINDOW_MS
    log('consent_granted', { window_ms: GRANT_WINDOW_MS })
  }
}

// Operator pre-authorisation: /grant <minutes> opens a bounded, file-backed window.
// Returns the clamped number of minutes actually granted.
export function grantScoped(minutes) {
  const m = Math.max(1, Math.min(1440, Math.floor(Number(minutes) || 0)))
  const until = Date.now() + m * 60_000
  try {
    fs.mkdirSync(path.dirname(consentFile), { recursive: true })
    fs.writeFileSync(consentFile, JSON.stringify({ until }))
    log('consent_scoped', { minutes: m })
  } catch (err) {
    log('consent_scoped_fail', { error: String(err).slice(0, 120) })
  }
  return m
}

function scopedUntil() {
  try {
    return Number(JSON.parse(fs.readFileSync(consentFile, 'utf8')).until) || 0
  } catch {
    return 0
  }
}

function isNightNow() {
  const h = Number(new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: config.timezone }))
  const { nightStartHour: s, nightEndHour: e } = config
  return s > e ? h >= s || h < e : h >= s && h < e
}

// Which consent source is currently valid, if any — also used to label the journal.
function consentSource() {
  const now = Date.now()
  if (now < grantedUntil) return 'chat'
  if (now < scopedUntil()) return 'scoped'
  if (config.nightAutoGrant && isNightNow()) return 'night'
  return null
}

export function hasConsent() {
  return consentSource() !== null
}

// Returns { allowed, reason }. Called before any tool that mutates the system.
export function guard(kind, payload = '') {
  const dangerous = kind === 'shell' && DANGEROUS.some((re) => re.test(payload))
  const paid = kind === 'paid'
  if (dangerous || paid) {
    const via = consentSource()
    if (!via) {
      log('guard_block', { kind, payload: String(payload).slice(0, 120) })
      return { allowed: false, reason: `blocked: "${kind}" needs an explicit yes from the operator first (or a /grant window)` }
    }
    log('guard_pass', { kind, via })
  }
  return { allowed: true }
}
