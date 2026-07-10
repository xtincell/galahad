// Brain — a thin client over ANY OpenAI-compatible chat/completions endpoint.
// Provider-agnostic: LLM_BASE_URL → Ollama Cloud, local Ollama, OpenAI, OpenRouter…
// Model id runtime-swappable (see /brain). AUTOMATIC FALLBACK: if the primary
// provider fails (429 rate-limit, 5xx, network), the request is replayed on a
// second provider (FALLBACK_*). An exhausted quota never puts the agent on the
// floor. Enable by setting FALLBACK_API_KEY.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log } from './journal.js'

// The model id lives in data/cerveau.txt so it survives restarts and can be
// swapped from OUTSIDE the process (cockpit / dan-brain) as well as via /brain.
// Hot-reloaded on mtime change; env GALAHAD_MODEL is only the first-boot default.
const cerveauFile = path.join(config.dataDir, 'cerveau.txt')
let cerveauMtime = 0
let currentModel = config.model
let tokensToday = 0
let tokenDay = new Date().toISOString().slice(0, 10)

function readCerveau() {
  try { return fs.readFileSync(cerveauFile, 'utf8').trim() || null } catch { return null }
}

export function getModel() {
  try {
    const m = fs.statSync(cerveauFile).mtimeMs
    if (m !== cerveauMtime) {
      cerveauMtime = m
      const v = readCerveau()
      if (v && v !== currentModel) { log('brain_swap', { model: v, via: 'cerveau.txt' }); currentModel = v }
    }
  } catch { /* no cerveau.txt yet → keep current */ }
  return currentModel
}

export function setModel(m) {
  currentModel = m
  try {
    fs.mkdirSync(path.dirname(cerveauFile), { recursive: true })
    fs.writeFileSync(cerveauFile, m)
    cerveauMtime = fs.statSync(cerveauFile).mtimeMs
  } catch (err) { log('brain_persist_fail', { error: String(err).slice(0, 120) }) }
}
export function tokensUsed() {
  const day = new Date().toISOString().slice(0, 10)
  if (day !== tokenDay) { tokenDay = day; tokensToday = 0 }
  return tokensToday
}

const FALLBACK = {
  baseUrl: process.env.FALLBACK_BASE_URL || 'https://openrouter.ai/api/v1',
  key: process.env.FALLBACK_API_KEY || '',
  model: process.env.FALLBACK_MODEL || 'deepseek/deepseek-v4-flash',
}

// One call to an OpenAI-compatible provider. Throws Error(.status) on non-2xx.
async function callProvider(baseUrl, key, model, body) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...body, model }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`brain HTTP ${res.status}: ${detail.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// messages: [{role, content}], tools: OpenAI tool schema array (optional).
export async function chat(messages, tools) {
  if (tokensUsed() > config.dailyTokenBudget) {
    throw new Error(`daily token budget exhausted (${config.dailyTokenBudget})`)
  }
  const body = { messages, temperature: 0.3 }
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto' }

  let data
  try {
    data = await callProvider(config.brainBaseUrl, config.brainKey, getModel(), body)
  } catch (err) {
    if (!FALLBACK.key) throw err // no fallback configured → surface the error
    log('brain_fallback', { from: getModel(), to: FALLBACK.model, reason: String(err?.message || err).slice(0, 120) })
    // Cap max_tokens on the fallback: OpenRouter reserves the model's full output
    // window by default (65k) and 402s when the credit balance can't cover it.
    data = await callProvider(FALLBACK.baseUrl, FALLBACK.key, FALLBACK.model, { ...body, max_tokens: 8192 })
  }
  tokensToday += data?.usage?.total_tokens || 0
  return data.choices?.[0]?.message || { content: '' }
}
