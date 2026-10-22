import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import { patch } from './scripts/bridge.mjs'

export const name = 'netease-whale-lyrics'
export function installBridge(profileDir = process.env.DSH_PROFILE_DIR || process.cwd()) {
  const candidates = [profileDir, path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'desktop')]
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
export function apply(ctx) {
  try { installBridge() } catch (err) {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('netease-whale-lyrics') : console
    logger.warn('歌词兼容桥未安装：' + err.message)
  }
}
