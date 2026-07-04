// Programmatic guardrails — the safety net that makes autonomy trustworthy.
// Rule: nothing destructive or paid runs without an explicit "yes" from the
// operator within a short window. This is enforced in code, not by prompt
// politeness — the model cannot talk its way past it.
import { log } from './journal.js'

const GRANT_WINDOW_MS = 5 * 60_000
let grantedUntil = 0

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

export function hasConsent() {
  return Date.now() < grantedUntil
}

// Returns { allowed, reason }. Called before any tool that mutates the system.
export function guard(kind, payload = '') {
  const dangerous = kind === 'shell' && DANGEROUS.some((re) => re.test(payload))
  const paid = kind === 'paid'
  if (dangerous || paid) {
    if (!hasConsent()) {
      log('guard_block', { kind, payload: String(payload).slice(0, 120) })
      return { allowed: false, reason: `blocked: "${kind}" needs an explicit yes from the operator first` }
    }
    log('guard_pass', { kind })
  }
  return { allowed: true }
}
