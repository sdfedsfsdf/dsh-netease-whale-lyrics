import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import { patch } from './scripts/bridge.mjs'

export const name = 'netease-whale-lyrics'

/* ── 设置持久化 ────────────────────────────────────────────────────────────
 * 为什么放主机端：DSH 每次启动端口会变，而浏览器 localStorage 按 origin（含端口）
 * 隔离 —— 设置存本地就等于「重启一次丢一次」，歌词看着看着就没了。
 * 存到 $DSH_HOME/netease-whale-lyrics/settings.json，跨重启/换端口都还在。
 * ─────────────────────────────────────────────────────────────────────── */
const MODES = ['off', 'continuous', 'click']
const DEFAULTS = { mode: 'off', fontPercent: 100 }
const clampFont = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(70, Math.min(160, Math.round(n))) : DEFAULTS.fontPercent
}
export function settingsPath() {
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'netease-whale-lyrics', 'settings.json')
}
export function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    return {
      saved: true,
      mode: MODES.includes(raw.mode) ? raw.mode : DEFAULTS.mode,
      fontPercent: clampFont(raw.fontPercent),
    }
  } catch {
    return { saved: false, ...DEFAULTS }
  }
}
export function writeSettings(patchIn) {
  const current = readSettings()
  const next = {
    mode: MODES.includes(patchIn?.mode) ? patchIn.mode : current.mode,
    fontPercent: patchIn?.fontPercent === undefined ? current.fontPercent : clampFont(patchIn.fontPercent),
  }
  const file = settingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return { saved: true, ...next }
}

/** 默认 profile 目录：只依赖 DSH_HOME，显式传参时优先用传入值。 */
export function defaultProfileDir() {
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'desktop')
}
export function installBridge(profileDir = defaultProfileDir()) {
  const candidates = [profileDir, defaultProfileDir()]
  let pkg
  for (const dir of candidates) {
    try { pkg = createRequire(path.join(dir, 'package.json')).resolve('dsh-whale-widget/package.json'); break } catch {}
  }
  if (!pkg) throw new Error('找不到 dsh-whale-widget，请先在同一 profile 安装鲸鱼插件')
  const file = path.join(path.dirname(pkg), 'assets', 'whale-widget.js')
  const original = fs.readFileSync(file, 'utf8')
  const updated = patch(original)
  new Script(updated, { filename: 'whale-widget.js' })
  if (updated === original) return { changed: false, file }
  // Version-specific untouched backup; never restore it over an upgraded whale package.
  const version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version
  const backup = file + '.before-lyrics-' + version
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { flag: 'wx' })
  fs.writeFileSync(file, updated, 'utf8')
  return { changed: true, file }
}

/** 面板/鲸鱼设置页读写设置用的本地 HTTP 路由（只接受同源 JSON） */
function mountApi(ctx, logger) {
  let webServer
  try { webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer } catch { webServer = null }
  if (!webServer?.register) { logger.log?.('webServer 不可用，歌词设置退回浏览器本地存储'); return }
  const csrf = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const sendJson = (res, status, value) => {
    try {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(value))
    } catch { /* 连接已断开 */ }
  }
  const route = async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname !== '/api/netease-whale-lyrics/settings') { res.statusCode = 404; return res.end('Not Found') }
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, csrfToken: csrf, settings: readSettings() })
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
    if (req.headers?.['x-whale-lyrics-csrf'] !== csrf) return sendJson(res, 403, { ok: false, error: '设置校验收到的令牌不对，请刷新页面' })
    let text = ''
    try {
      for await (const chunk of req) text += chunk
      if (text.length > 4096) throw new Error('请求体过大')
      const body = text ? JSON.parse(text) : {}
      return sendJson(res, 200, { ok: true, settings: writeSettings(body) })
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: String(err?.message || err) })
    }
  }
  try {
    ctx.effect(() => webServer.register({ kind: 'prefix', path: '/api/netease-whale-lyrics', handler: route }), 'netease-whale-lyrics: settings API')
  } catch (err) { logger.warn?.('歌词设置路由没挂上：' + (err?.message || err)) }
}

export function apply(ctx) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('netease-whale-lyrics') : console
  try { installBridge() } catch (err) {
    logger.warn('歌词兼容桥未安装：' + err.message)
  }
  mountApi(ctx, logger)
}
