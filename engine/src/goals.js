// Declarative objectives (/goal) — data/goals.json. The operator confides work;
// the traveler pursues it during its night-exploration window. Editable by hand or /goal.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

const goalsFile = path.join(config.dataDir, 'goals.json')
function read() { try { return JSON.parse(fs.readFileSync(goalsFile, 'utf8')) } catch { return [] } }
function write(goals) { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(goalsFile, JSON.stringify(goals, null, 2)) }
export function pendingGoals() { return read().filter((g) => !g.done) }
export function addGoal(text) { const g = read(); g.push({ text, done: false, at: new Date().toISOString() }); write(g); return g.length }
export function formatGoals(goals) { return goals.length ? goals.map((g, i) => `${i + 1}. ${g.done ? '✅' : '⬜'} ${g.text}`).join('\n') : '(no goals)' }
