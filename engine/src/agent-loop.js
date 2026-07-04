// The agentic loop: system prompt (SOUL + memory index) → brain → tool calls →
// brain → … until a final answer or maxTurns. Keeps one rolling conversation
// per process; /new resets it.
import fs from 'node:fs'
import { config } from './config.js'
import { chat, getModel } from './brain.js'
import { toolSchemas, runTool } from './tools.js'
import { readIndex } from './memory.js'
import { log } from './journal.js'

let history = []

function soul() {
  let s = ''
  try { s = fs.readFileSync(config.soulFile, 'utf8') } catch { s = `You are ${config.agentName}.` }
  const mem = readIndex()
  return `${s}\n\n---\nYou are "${config.agentName}" (role: ${config.role}). Model: ${getModel()}.` +
    `\nShared workspace: ${config.workspace}.` +
    (mem ? `\n\n# Your memory index\n${mem}` : '') +
    `\n\nOperating rules: read before you write; nothing destructive or paid without the operator's explicit yes; never print secrets; when unsure of the target, ask. Answer in the operator's language, dense and direct.`
}

export function resetSession() { history = [] }

export async function think({ prompt }) {
  if (history.length === 0) history.push({ role: 'system', content: soul() })
  history.push({ role: 'user', content: prompt })

  for (let turn = 0; turn < config.maxTurns; turn++) {
    const msg = await chat(history, toolSchemas)
    history.push(msg)

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
        log('tool_call', { name: tc.function.name })
        const result = await runTool(tc.function.name, args)
        history.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 8000) })
      }
      continue // let the brain react to tool output
    }
    // No tool calls → final answer.
    return { text: msg.content || '' }
  }
  return { text: '[reached max turns without concluding]' }
}
