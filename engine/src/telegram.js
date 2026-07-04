// Telegram gateway — long-polling, no inbound port. The agent talks to exactly
// one authorised chat id; messages from anyone else are logged and ignored.
import { config } from './config.js'
import { log } from './journal.js'

const API = (m) => `https://api.telegram.org/bot${config.telegramToken}/${m}`

async function call(method, params) {
  const res = await fetch(API(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  })
  return res.json().catch(() => ({}))
}

export async function send(text) {
  if (!text) return
  // Telegram caps messages at 4096 chars.
  for (let i = 0; i < text.length; i += 4000) {
    await call('sendMessage', { chat_id: config.telegramChatId, text: text.slice(i, i + 4000) })
  }
}

export function typing() {
  call('sendChatAction', { chat_id: config.telegramChatId, action: 'typing' }).catch(() => {})
}

export async function pollLoop(onMessage) {
  let offset = 0
  for (;;) {
    try {
      const r = await call('getUpdates', { offset, timeout: 50 })
      for (const u of r.result || []) {
        offset = u.update_id + 1
        const msg = u.message
        if (!msg?.text) continue
        if (String(msg.chat.id) !== config.telegramChatId) {
          log('telegram_intruder', { from: msg.chat.id })
          continue
        }
        try { await onMessage(msg.text.trim()) } catch (e) { log('handler_error', { error: String(e) }) }
      }
    } catch (e) {
      log('poll_error', { error: String(e) })
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
