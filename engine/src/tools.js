// Tools the brain can call. Every mutating tool passes through guard() first.
// The Claude bridge is exposed as a tool so any agent can delegate heavy dev.
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { guard } from './hooks.js'
import { writeCard, readCard } from './memory.js'
import { log } from './journal.js'
import { radarSchemas, isRadarTool, radarRun, danmemSchemas, isDanmemTool, danmemRun } from './integrations.js'

const sh = promisify(exec)

export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a shell command on the VPS. Destructive/paid commands are blocked unless the operator gave an explicit yes.',
      parameters: {
        type: 'object',
        properties: { cmd: { type: 'string', description: 'the command to run' } },
        required: ['cmd'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 file from disk (read-only).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Persist a durable fact to memory as a markdown card.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'kebab-case slug' },
          title: { type: 'string' },
          body: { type: 'string', description: 'FACT — gloss (implication). Absolute dates.' },
        },
        required: ['name', 'title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: 'Read back a memory card by its slug.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_claude',
      description: 'Delegate a heavy coding/reasoning task to the Claude bridge and get the result. Use for real dev work.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          repo: { type: 'string', description: 'optional workspace repo to run inside' },
        },
        required: ['prompt'],
      },
    },
  },
  ...radarSchemas,
  ...danmemSchemas,
]

export async function runTool(name, args) {
  if (isRadarTool(name)) return radarRun(name, args)
  if (isDanmemTool(name)) return danmemRun(name, args)
  switch (name) {
    case 'shell': {
      const g = guard('shell', args.cmd)
      if (!g.allowed) return g.reason
      try {
        const { stdout, stderr } = await sh(args.cmd, { cwd: config.workspace, timeout: 120_000, maxBuffer: 4 << 20 })
        return (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '')
      } catch (e) {
        return `[error] ${e.message}\n${e.stdout || ''}${e.stderr || ''}`.slice(0, 4000)
      }
    }
    case 'read_file': {
      try { return fs.readFileSync(path.resolve(args.path), 'utf8').slice(0, 8000) }
      catch (e) { return `[error] ${e.message}` }
    }
    case 'remember':
      return `saved: ${writeCard(args.name, args.title, args.body)}`
    case 'recall':
      return readCard(args.name) || `[no card named ${args.name}]`
    case 'call_claude':
      return callBridge(args.prompt, args.repo)
    default:
      return `[error] unknown tool ${name}`
  }
}

// The on-demand heavy-dev muscle. Optional: only wired if CLAUDE_BRIDGE_URL set.
async function callBridge(prompt, repo) {
  if (!config.bridgeUrl || !config.bridgeToken) {
    return '[claude bridge not configured on this deployment]'
  }
  const g = guard('paid') // Claude calls cost money → gated like any paid action.
  if (!g.allowed) return g.reason
  log('bridge_call', { repo: repo || null, prompt: String(prompt).slice(0, 120) })
  try {
    const res = await fetch(`${config.bridgeUrl}/convoque`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: config.bridgeToken, prompt, repo, sync: true }),
    })
    const data = await res.json()
    return data.result || data.error || '[bridge: empty response]'
  } catch (e) {
    return `[bridge error] ${e.message}`
  }
}
