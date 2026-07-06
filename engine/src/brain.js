// Brain — a thin client over ANY OpenAI-compatible chat/completions endpoint.
// Provider-agnostic: LLM_BASE_URL → Ollama Cloud, local Ollama, OpenAI, OpenRouter…
// Model id runtime-swappable (see /brain). AUTOMATIC FALLBACK: if the primary
// provider fails (429 rate-limit, 5xx, network), the request is replayed on a
// second provider (FALLBACK_*). An exhausted quota never puts the agent on the
// floor. Enable by setting FALLBACK_API_KEY.
import { config } from './config.js'
import { log } from './journal.js'

let currentModel = config.model
let tokensToday = 0
let tokenDay = new Date().toISOString().slice(0, 10)

export function getModel() { return currentModel }
export function setModel(m) { currentModel = m }
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
    data = await callProvider(config.brainBaseUrl, config.brainKey, currentModel, body)
  } catch (err) {
    if (!FALLBACK.key) throw err // no fallback configured → surface the error
    log('brain_fallback', { from: currentModel, to: FALLBACK.model, reason: String(err?.message || err).slice(0, 120) })
    data = await callProvider(FALLBACK.baseUrl, FALLBACK.key, FALLBACK.model, body)
  }
  tokensToday += data?.usage?.total_tokens || 0
  return data.choices?.[0]?.message || { content: '' }
}
