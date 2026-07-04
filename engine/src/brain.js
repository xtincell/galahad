// Brain — a thin client over ANY OpenAI-compatible chat/completions endpoint.
// Provider-agnostic: point LLM_BASE_URL at Ollama Cloud, a local Ollama, OpenAI,
// Together, Groq, OpenRouter… The model id is runtime-swappable (see /brain).
import { config } from './config.js'

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

// messages: [{role, content}], tools: OpenAI tool schema array (optional).
export async function chat(messages, tools) {
  if (tokensUsed() > config.dailyTokenBudget) {
    throw new Error(`daily token budget exhausted (${config.dailyTokenBudget})`)
  }
  const body = { model: currentModel, messages, temperature: 0.3 }
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto' }

  const res = await fetch(`${config.brainBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.brainKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`brain HTTP ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  tokensToday += data?.usage?.total_tokens || 0
  return data.choices?.[0]?.message || { content: '' }
}
