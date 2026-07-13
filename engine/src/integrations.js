// Optional integrations wired as native tools — no MCP subprocess, pure HTTP:
//  • external task-tracker(s) ("radar"), PostgREST-style full-access API, declared via env
//  • danmem (shared team memory)
// Schemas are empty [] when the matching env is absent, so other roles stay clean.
import { config } from './config.js'

const enc = encodeURIComponent
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } })

// ── Radars ──────────────────────────────────────────────────────────────────
async function radarApi(radar, method, pathq, body) {
  const cfg = config.radar[radar]
  if (!cfg || !cfg.url || !cfg.key) throw new Error(`radar "${radar}" not configured`)
  const base = cfg.url.replace(/\/+$/, '')
  const headers = { authorization: 'Bearer ' + cfg.key, 'content-type': 'application/json' }
  if (method !== 'GET') headers.Prefer = 'return=representation'
  const res = await fetch(base + '/rest/v1/' + pathq, { method, headers, body: body != null ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${radar} ${method} ${pathq} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return text }
}
const RADAR_ARG = { radar: { type: 'string', enum: config.radarNames, description: 'which task-tracker instance (one of the configured RADAR_INSTANCES)' } }
export const radarSchemas = config.radarNames.length ? [
  fn('radar_list', 'List/search tasks (briefs) of a radar. No query = all (cap 200). Full-access.', { ...RADAR_ARG, query: { type: 'string' } }, ['radar']),
  fn('radar_get', 'Get a full task by its ndeg.', { ...RADAR_ARG, ndeg: { type: 'string' } }, ['radar', 'ndeg']),
  fn('radar_create', 'Create a task. fields = snake_case columns (ndeg, client, marque, projet, statut, prio, responsable, deadline...).', { ...RADAR_ARG, fields: { type: 'object' } }, ['radar', 'fields']),
  fn('radar_update', 'Update a task by ndeg. patch = fields to change.', { ...RADAR_ARG, ndeg: { type: 'string' }, patch: { type: 'object' } }, ['radar', 'ndeg', 'patch']),
  fn('radar_delete', 'Delete a task by ndeg (irreversible).', { ...RADAR_ARG, ndeg: { type: 'string' } }, ['radar', 'ndeg']),
  fn('radar_comment', 'Add an observation/comment to a task.', { ...RADAR_ARG, ndeg: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' } }, ['radar', 'ndeg', 'text']),
  fn('radar_activity', 'Recent activity log (task_events).', { ...RADAR_ARG, limit: { type: 'number' } }, ['radar']),
] : []
export const isRadarTool = (n) => n.startsWith('radar_')
export async function radarRun(name, a) {
  switch (name) {
    case 'radar_list': {
      const rows = await radarApi(a.radar, 'GET', 'briefs?select=ndeg,client,marque,projet,statut,responsable,deadline,prio,avancement&order=ndeg.asc&limit=5000')
      const q = (a.query || '').toLowerCase().trim()
      const keys = ['ndeg', 'client', 'marque', 'projet', 'statut', 'responsable']
      const hits = !q ? rows.slice(0, 200) : rows.filter((b) => keys.some((k) => String(b[k] || '').toLowerCase().includes(q))).slice(0, 200)
      return JSON.stringify({ count: hits.length, tasks: hits })
    }
    case 'radar_get': { const r = await radarApi(a.radar, 'GET', `briefs?select=*&ndeg=eq.${enc(a.ndeg)}`); return JSON.stringify(r[0] || `no task "${a.ndeg}"`) }
    case 'radar_create': { const r = await radarApi(a.radar, 'POST', 'briefs', [a.fields]); return JSON.stringify({ created: r[0] || a.fields }) }
    case 'radar_update': { const r = await radarApi(a.radar, 'PATCH', `briefs?ndeg=eq.${enc(a.ndeg)}`, a.patch); return JSON.stringify(r.length ? { updated: r } : `no task "${a.ndeg}"`) }
    case 'radar_delete': { const r = await radarApi(a.radar, 'DELETE', `briefs?ndeg=eq.${enc(a.ndeg)}`); return r.length ? `deleted ${a.ndeg} (${r.length})` : `no task "${a.ndeg}"` }
    case 'radar_comment': { const r = await radarApi(a.radar, 'POST', 'comments', [{ ndeg: a.ndeg, author: a.author || config.agentName, body: a.text }]); return JSON.stringify({ comment: r[0] || { ndeg: a.ndeg } }) }
    case 'radar_activity': { const n = Math.min(Math.max(Number(a.limit) || 30, 1), 200); const r = await radarApi(a.radar, 'GET', `task_events?select=at,kind,ndeg,client,projet,statut_old,statut_new,resp_old,resp_new,summary&order=at.desc&limit=${n}`); return JSON.stringify({ count: r.length, events: r }) }
  }
}

// ── danmem (shared memory) ───────────────────────────────────────────────────
async function danmemCall(method, p, payload) {
  const base = (config.danmemUrl || '').replace(/\/+$/, '')
  const req = { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.danmemToken } }
  if (payload != null) req.body = JSON.stringify(payload)
  const res = await fetch(base + p, req)
  if (!res.ok) throw new Error(`danmem ${method} ${p} -> HTTP ${res.status}`)
  return res.json()
}
export const danmemSchemas = config.danmemUrl ? [
  fn('memoire_observer', 'Store a durable fact in shared danmem. peer = subject (operator, an agent, a project...).', { contenu: { type: 'string' }, peer: { type: 'string' }, strate: { type: 'string' } }, ['contenu']),
  fn('memoire_demander', 'Query a peer danmem (recall + LLM synthesis).', { question: { type: 'string' }, peer: { type: 'string' } }, ['question']),
  fn('memoire_carte', 'Read a peer synthetic card (no LLM).', { peer: { type: 'string' } }, []),
  fn('memoire_peers', 'List danmem peers with observation counts.', {}, []),
] : []
// Programmatic write for the skill-runner (and anything else) to record shared state.
// No-op if danmem isn't configured; never throws on a missing config, only on a live HTTP error.
export async function danmemObserve(peer, content, opts = {}) {
  if (!config.danmemUrl) return null
  return danmemCall('POST', '/observe', {
    peer: peer || config.agentName,
    content: content || '',
    strate: opts.strate || 'S2',
    kind: opts.kind || 'note',
    source: opts.source || config.agentName,
  })
}
export const isDanmemTool = (n) => n.startsWith('memoire_')
export async function danmemRun(name, a) {
  switch (name) {
    case 'memoire_observer': { const d = await danmemCall('POST', '/observe', { peer: a.peer || config.agentName, content: a.contenu || '', strate: a.strate || 'S1', kind: 'note', source: config.agentName }); return `observation stored (id ${d.id || '?'})` }
    case 'memoire_demander': { const d = await danmemCall('POST', '/dialectic', { peer: a.peer || config.operatorName, question: a.question || '' }); return d.answer || d.error || JSON.stringify(d) }
    case 'memoire_carte': { const d = await danmemCall('GET', '/card/' + (a.peer || config.operatorName)); return d.card || '(no card)' }
    case 'memoire_peers': { const d = await danmemCall('GET', '/peers'); return (d.peers || []).map((p) => `${p.id} [${p.kind || '?'}] ${p.obs} obs`).join('\n') || '(no peers)' }
  }
}
