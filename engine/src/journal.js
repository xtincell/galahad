// Append-only JSONL journal — one line per event, one file per day.
// Secrets are never written here; refer to them by name.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

export function log(event, data = {}) {
  const day = new Date().toISOString().slice(0, 10)
  const line = JSON.stringify({ t: new Date().toISOString(), role: config.role, event, ...data }) + '\n'
  try {
    fs.mkdirSync(config.journalDir, { recursive: true })
    fs.appendFileSync(path.join(config.journalDir, `${day}.jsonl`), line)
  } catch (e) {
    console.error('[journal] write failed:', e.message)
  }
  // Mirror to stdout so `docker logs` shows activity.
  console.log(`[${config.role}] ${event}`, Object.keys(data).length ? JSON.stringify(data).slice(0, 300) : '')
}
