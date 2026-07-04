// File-based memory — markdown cards in memory/, indexed by MEMORY.md.
// The index is injected into the system prompt at wake-up so the agent keeps
// continuity across restarts. Convention for a card body: `FACT — gloss
// (implication)`, absolute dates. No personal data of the operator is stored.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

const INDEX = () => path.join(config.memoryDir, 'MEMORY.md')

export function ensureMemory() {
  fs.mkdirSync(config.memoryDir, { recursive: true })
  if (!fs.existsSync(INDEX())) {
    fs.writeFileSync(INDEX(), `# ${config.agentName} — memory index\n\nOne line per card. Cards live beside this file.\n`)
  }
}

export function readIndex() {
  try { return fs.readFileSync(INDEX(), 'utf8') } catch { return '' }
}

export function readCard(name) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '')
  try { return fs.readFileSync(path.join(config.memoryDir, `${safe}.md`), 'utf8') } catch { return null }
}

// Write/replace a card and add a pointer line to the index if missing.
export function writeCard(name, title, body) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '')
  fs.mkdirSync(config.memoryDir, { recursive: true })
  fs.writeFileSync(path.join(config.memoryDir, `${safe}.md`), `# ${title}\n\n${body.trim()}\n`)
  const pointer = `- [${title}](${safe}.md)`
  const idx = readIndex()
  if (!idx.includes(`(${safe}.md)`)) fs.appendFileSync(INDEX(), `\n${pointer}`)
  return safe
}
