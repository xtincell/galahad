#!/usr/bin/env node
// Galahad — web setup wizard server. stdlib only (node:http, node:fs, node:child_process, node:os).
// Serves setup/index.html, exposes /schema (parsed from .env.example), /save (writes ../.env),
// /deploy (docker compose up -d --build) and /status. No npm dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const SETUP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SETUP_DIR, '..');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');
const ENV_PATH = path.join(ROOT, '.env');
const INDEX_HTML_PATH = path.join(SETUP_DIR, 'index.html');
const COCKPIT_HTML_PATH = path.join(ROOT, 'cockpit', 'index.html');

const PORT = Number(process.env.SETUP_PORT) || 8080;

// ── .env.example parsing ─────────────────────────────────────────────────────
// Turns the commented, sectioned .env.example into a JSON schema: sections →
// fields, each with a help string (from the comments above it), a default
// (its current value) and whether it's required (value === REPLACE_ME).

const SECTION_HEADER_RE = /^#\s*─{2,}\s*(.+?)\s*─{2,}\s*$/;
const FULL_DIVIDER_RE = /^#\s*─+\s*$/;
const KEY_LINE_RE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

function fieldType(key) {
  if (/_MINUTES$|_WARN$|^NIGHT_(START|END)$/.test(key)) return 'number';
  if (/_URL$/.test(key)) return 'url';
  if (/(TOKEN|KEY|SECRET|PASSWORD)$/.test(key)) return 'password';
  return 'text';
}

function parseEnvExample() {
  const text = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;
  let pending = [];

  function section(title) {
    let s = sections.find((x) => x.title === title);
    if (!s) { s = { title, fields: [] }; sections.push(s); }
    return s;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') { pending = []; continue; }
    if (FULL_DIVIDER_RE.test(line)) continue;
    const sectionMatch = SECTION_HEADER_RE.exec(line);
    if (sectionMatch) { currentSection = sectionMatch[1]; pending = []; continue; }
    if (line.startsWith('#')) {
      if (/^#\s*[A-Z][A-Z0-9_]*=/.test(line)) continue; // commented-out example key, skip
      pending.push(line.replace(/^#\s?/, ''));
      continue;
    }
    const keyMatch = KEY_LINE_RE.exec(line);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    let value = keyMatch[2];
    let inline = '';
    const hashIdx = value.indexOf('#');
    if (hashIdx !== -1) {
      inline = value.slice(hashIdx + 1).trim();
      value = value.slice(0, hashIdx).trim();
    } else {
      value = value.trim();
    }
    const required = value === 'REPLACE_ME';
    const help = [pending.join(' '), inline].filter(Boolean).join(' ').trim();
    section(currentSection || 'General').fields.push({
      key,
      help,
      default: required ? '' : value,
      required,
      secret: fieldType(key) === 'password',
      type: fieldType(key),
    });
  }
  return { sections };
}

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = KEY_LINE_RE.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function requiredKeys() {
  const schema = parseEnvExample();
  return schema.sections.flatMap((s) => s.fields).filter((f) => f.required).map((f) => f.key);
}

function isConfigured() {
  if (!fs.existsSync(ENV_PATH)) return false;
  let env;
  try { env = parseDotEnv(fs.readFileSync(ENV_PATH, 'utf8')); } catch { return false; }
  return requiredKeys().every((k) => env[k] && env[k] !== 'REPLACE_ME');
}

// ── .env writer ───────────────────────────────────────────────────────────────
// Starts from .env.example so every field (including ones the client never
// touched) keeps a valid default; only non-empty overrides replace a line.
// Keys the client sends that don't exist in .env.example (e.g. per-instance
// RADAR_<NAME>_URL/_KEY generated in the browser) are appended at the end.

function buildEnvContent(overrides) {
  const template = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const lines = template.split('\n');
  const used = new Set();

  const out = lines.map((line) => {
    const m = KEY_LINE_RE.exec(line);
    if (!m) return line;
    const key = m[1];
    used.add(key);
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const v = overrides[key];
      if (typeof v === 'string' && v.trim() !== '') {
        return `${key}=${v.replace(/[\r\n]/g, ' ').trim()}`;
      }
    }
    return line;
  });

  const extraKeys = Object.keys(overrides).filter(
    (k) => /^[A-Z][A-Z0-9_]*$/.test(k) && !used.has(k) &&
      typeof overrides[k] === 'string' && overrides[k].trim() !== ''
  );

  let content = out.join('\n');
  if (extraKeys.length) {
    content += '\n\n# ── Additional (generated by setup wizard) ──\n';
    for (const k of extraKeys) content += `${k}=${overrides[k].replace(/[\r\n]/g, ' ').trim()}\n`;
  }
  return content;
}

// ── docker compose helpers ────────────────────────────────────────────────────

function composeCmd() {
  const probe = spawnSync('docker', ['compose', 'version'], { timeout: 3000 });
  if (!probe.error && probe.status === 0) return ['docker', 'compose'];
  return ['docker-compose'];
}

function composeStatus() {
  try {
    const [cmd, ...args] = composeCmd();
    const r = spawnSync(cmd, [...args, 'ps', '--status', 'running', '--format', '{{.Name}}'], {
      cwd: ROOT, encoding: 'utf8', timeout: 5000,
    });
    if (r.error || r.status !== 0) return { up: false, services: [] };
    const services = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    return { up: services.length > 0, services };
  } catch {
    return { up: false, services: [] };
  }
}

function deploy() {
  return new Promise((resolve) => {
    const [cmd, ...args] = composeCmd();
    let logs = '';
    let child;
    try {
      child = spawn(cmd, [...args, 'up', '-d', '--build'], { cwd: ROOT });
    } catch (err) {
      resolve({ ok: false, code: -1, logs: String(err) });
      return;
    }
    child.stdout.on('data', (d) => { logs += d.toString(); });
    child.stderr.on('data', (d) => { logs += d.toString(); });
    child.on('close', (code) => resolve({ ok: code === 0, code, logs }));
    child.on('error', (err) => resolve({ ok: false, code: -1, logs: `${logs}\n${err}` }));
  });
}

// ── networking / IP for the boot banner ──────────────────────────────────────

async function getDisplayIP() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch('https://api.ipify.org', { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const ip = (await r.text()).trim();
      if (ip) return ip;
    }
  } catch { /* no outbound network — fall back below */ }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── tiny HTTP helpers ─────────────────────────────────────────────────────────

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function readJsonBody(req, maxBytes = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

// ── router ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/') {
      serveFile(res, INDEX_HTML_PATH, 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && pathname === '/cockpit') {
      serveFile(res, COCKPIT_HTML_PATH, 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && pathname === '/schema') {
      sendJson(res, 200, parseEnvExample());
      return;
    }

    if (req.method === 'GET' && pathname === '/status') {
      sendJson(res, 200, {
        envExists: fs.existsSync(ENV_PATH),
        configured: isConfigured(),
        containers: composeStatus(),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/save') {
      const force = url.searchParams.get('force') === '1';
      if (isConfigured() && !force) {
        sendJson(res, 403, { ok: false, error: 'already_configured', redirect: '/cockpit' });
        return;
      }
      let body;
      try { body = await readJsonBody(req); }
      catch (err) { sendJson(res, 400, { ok: false, error: err.message }); return; }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        sendJson(res, 400, { ok: false, error: 'invalid_body' });
        return;
      }
      const overrides = {};
      for (const [k, v] of Object.entries(body)) {
        if (/^[A-Z][A-Z0-9_]*$/.test(k)) overrides[k] = String(v ?? '');
      }
      const content = buildEnvContent(overrides);
      fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
      fs.chmodSync(ENV_PATH, 0o600);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/deploy') {
      if (!fs.existsSync(ENV_PATH)) {
        sendJson(res, 400, { ok: false, error: 'no_env', message: 'Configure d’abord (/save) avant de déployer.' });
        return;
      }
      const result = await deploy();
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message || err) });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  const ip = await getDisplayIP();
  console.log(`Galahad setup wizard → http://${ip}:${PORT}`);
  console.log(`(local: http://localhost:${PORT})`);
});
