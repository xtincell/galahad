#!/usr/bin/env node
// Claude bridge — "Claude as a summonable tool" for the Galahad team.
// The agents run cheap models; when real code has to be written they POST a
// prompt here and this service runs the Claude CLI headless, streaming output.
// Listens only on an internal address, protected by a token. Zero Internet
// exposure, zero dependencies (native http).
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, createWriteStream, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

const HOST = process.env.BRIDGE_HOST || '0.0.0.0'
const PORT = Number(process.env.BRIDGE_PORT || 8799)
const TOKEN = process.env.BRIDGE_TOKEN
const CWD = process.env.BRIDGE_CWD || '/workspace'
const DEFAULT_MODEL = process.env.BRIDGE_MODEL || 'claude-sonnet-5'
const TIMEOUT = Number(process.env.BRIDGE_TIMEOUT_MS || 600_000)

if (!TOKEN) { console.error('[bridge] BRIDGE_TOKEN missing'); process.exit(1) }

const sessions = new Map() // id -> { child, file, ended, code }
let seq = 0

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
const tokenOk = (req, url, bodyToken) =>
  (bodyToken || req.headers['x-bridge-token'] || url.searchParams.get('token')) === TOKEN

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const path = url.pathname

  if (req.method === 'GET' && path === '/health') {
    if (!tokenOk(req, url)) return json(res, 403, { error: 'bad token' })
    return json(res, 200, { ok: true, sessions: sessions.size })
  }

  if (req.method === 'GET' && path.startsWith('/stream/')) {
    if (!tokenOk(req, url)) return json(res, 403, { error: 'bad token' })
    const s = sessions.get(path.slice('/stream/'.length))
    if (!s) return json(res, 404, { error: 'unknown session' })
    let content = ''
    try { content = existsSync(s.file) ? readFileSync(s.file, 'utf8') : '' } catch {}
    return json(res, 200, { ended: s.ended, code: s.code, content })
  }

  if (req.method === 'POST' && path.startsWith('/abort/')) {
    if (!tokenOk(req, url)) return json(res, 403, { error: 'bad token' })
    const s = sessions.get(path.slice('/abort/'.length))
    if (!s) return json(res, 404, { error: 'unknown session' })
    if (s.ended) return json(res, 200, { aborted: false, note: 'already done' })
    try { s.child.kill('SIGTERM') } catch (e) { return json(res, 500, { error: String(e) }) }
    return json(res, 200, { aborted: true })
  }

  if (req.method === 'POST' && (path === '/convoque' || path === '/')) {
    let bodyStr = ''
    req.on('data', (c) => { bodyStr += c; if (bodyStr.length > 200_000) req.destroy() })
    req.on('end', () => {
      let j = {}
      try { j = JSON.parse(bodyStr) } catch { return json(res, 400, { error: 'bad JSON' }) }
      if (j.token !== TOKEN) return json(res, 403, { error: 'bad token' })

      const sync = j.sync === true || path === '/'
      const prompt = String(j.prompt || '').slice(0, 40_000)
      if (!prompt) return json(res, 400, { error: 'empty prompt' })
      const model = String(j.model || DEFAULT_MODEL)

      let cwd = CWD
      const repo = String(j.repo || '').replace(/[^A-Za-z0-9._-]/g, '')
      if (repo) {
        const cand = join(CWD, repo)
        if (cand.startsWith(CWD + sep) && existsSync(cand)) cwd = cand
        else return json(res, 400, { error: `unknown repo: ${repo}` })
      }

      const id = `${Date.now()}_${seq++}`
      const file = `/tmp/claude_${id}.log`
      const out = createWriteStream(file, { flags: 'w' })
      out.write(`[bridge] session=${id} model=${model} cwd=${cwd}\n--- start ---\n`)

      const args = ['-p', prompt, '--model', model, '--permission-mode', 'bypassPermissions']
      const child = spawn('claude', args, { cwd, env: process.env, timeout: TIMEOUT, killSignal: 'SIGTERM' })
      const rec = { child, file, ended: false, code: null }
      sessions.set(id, rec)

      child.stdout.on('data', (d) => out.write(d))
      child.stderr.on('data', (d) => out.write(d))
      child.on('error', (e) => out.write(`\n[bridge] spawn error: ${e.message}\n`))
      child.on('close', (code) => { rec.ended = true; rec.code = code; out.end(`\n--- end (${code}) ---\n`) })
      if (child.stdin) child.stdin.end()

      if (sync) {
        child.on('close', () => {
          let content = ''
          try { content = existsSync(file) ? readFileSync(file, 'utf8') : '' } catch {}
          const lines = content.split('\n')
          let started = false, result = []
          for (const line of lines) {
            if (line.includes('--- start ---')) { started = true; continue }
            if (line.includes('--- end')) continue
            if (line.includes('[bridge]')) continue
            if (started) result.push(line)
          }
          json(res, 200, { result: result.join('\n').trim() || content, model, session_id: id })
        })
      } else {
        json(res, 202, { session_id: id, model })
      }
    })
    return
  }
  return json(res, 404, { error: 'endpoints: GET /health, POST /convoque, GET /stream/<id>, POST /abort/<id>' })
})

server.listen(PORT, HOST, () => console.log(`[bridge] Galahad Claude bridge on ${HOST}:${PORT} (default ${DEFAULT_MODEL})`))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
